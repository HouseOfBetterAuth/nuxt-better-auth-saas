import type { ChatToolInvocation } from '~~/server/services/chat/tools'
import type { ChatRequestBody } from '~~/server/types/api'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'
import { runChatAgentWithMultiPass } from '~~/server/services/chat/agent'
import {
  addLogEntryToChatSession,
  addMessageToChatSession,
  getChatSessionById,
  getOrCreateChatSessionForContent,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { generateContentDraftFromSource, updateContentSectionWithAI } from '~~/server/services/content/generation'
import { buildWorkspaceFilesPayload } from '~~/server/services/content/workspaceFiles'
import { buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { ingestYouTubeVideoAsSourceContent } from '~~/server/services/sourceContent/youtubeIngest'
import { getAuthSession, requireAuth } from '~~/server/utils/auth'
import { extractYouTubeId } from '~~/server/utils/chat'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, slugifyTitle } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateEnum, validateNumber, validateOptionalString, validateOptionalUUID, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'
import { DEFAULT_CONTENT_TYPE } from '~~/shared/constants/contentTypes'

// eslint-disable-next-line no-control-regex
const PROMPT_SANITIZE_PATTERN = /[\u0000-\u001F\u007F]+/g

function sanitizePromptSnippet(value?: string, maxLength = 1000) {
  if (!value) {
    return ''
  }
  const normalized = value
    .replace(PROMPT_SANITIZE_PATTERN, ' ')
    .replace(/```/g, '\\`\\`\\`')
    .replace(/<\/?system>/gi, '')
    .trim()
  if (!normalized) {
    return ''
  }
  return normalized.slice(0, maxLength)
}

function wrapPromptSnippet(label: string, value?: string, maxLength = 1000) {
  const sanitized = sanitizePromptSnippet(value, maxLength)
  if (!sanitized) {
    return ''
  }
  return `${label}:\n"""${sanitized}"""`
}

function toSummaryBullets(text: string | null | undefined) {
  if (!text) {
    return []
  }
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }
  const newlineSplit = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (newlineSplit.length > 1) {
    return newlineSplit
  }
  const sentences = normalized.split(/(?<=[.!?])\s+/).map(line => line.trim()).filter(Boolean)
  return sentences.length ? sentences : [normalized]
}

async function composeWorkspaceCompletionMessages(
  db: Awaited<ReturnType<typeof useDB>>,
  organizationId: string,
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect
) {
  const sourceContentId =
    (version.frontmatter as Record<string, any> | null | undefined)?.sourceContentId
    || content.sourceContentId
    || (version.assets && typeof version.assets === 'object' ? (version.assets as any).source?.id : null)

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null
  if (sourceContentId) {
    const [record] = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.id, sourceContentId),
        eq(schema.sourceContent.organizationId, organizationId)
      ))
      .limit(1)
    sourceContent = record ?? null
  }

  const workspaceSummary = buildWorkspaceSummary({
    content,
    currentVersion: version,
    sourceContent
  })
  const summaryBullets = toSummaryBullets(workspaceSummary)
  const summaryText = ['**Summary**', ...(summaryBullets.length ? summaryBullets : ['Draft updated.']).map(item => `- ${item}`)].join('\n')
  const filesPayload = buildWorkspaceFilesPayload(content, version, sourceContent)
  const filesText = ['**Files**', ...filesPayload.map(file => `- ${file.filename}`)].join('\n')

  return {
    summary: {
      content: summaryText,
      payload: {
        type: 'workspace_summary',
        summary: workspaceSummary || 'Draft updated.'
      }
    },
    files: {
      content: filesText,
      payload: {
        type: 'workspace_files',
        files: filesPayload
      }
    }
  }
}

interface ToolExecutionResult {
  success: boolean
  result?: any
  error?: string
  sourceContentId?: string | null
  contentId?: string | null
}

async function executeChatTool(
  toolInvocation: ChatToolInvocation,
  context: {
    db: Awaited<ReturnType<typeof useDB>>
    organizationId: string
    userId: string
    sessionId: string
    event: any
  }
): Promise<ToolExecutionResult> {
  const { db, organizationId, userId, sessionId } = context

  if (toolInvocation.name === 'ingest_youtube') {
    // TypeScript now knows this is ingest_youtube
    const args = toolInvocation.arguments as ChatToolInvocation<'ingest_youtube'>['arguments']
    const youtubeUrl = validateRequiredString(args.youtubeUrl, 'youtubeUrl')
    const titleHint = validateOptionalString(args.titleHint, 'titleHint')

    if (!runtimeConfig.enableYoutubeIngestion) {
      return {
        success: false,
        error: 'YouTube ingestion is currently disabled'
      }
    }

    let videoId: string | null = null
    try {
      const url = new URL(youtubeUrl)
      videoId = extractYouTubeId(url)
    } catch {
      videoId = null
    }

    if (!videoId) {
      return {
        success: false,
        error: 'Unable to parse YouTube video ID from the provided URL'
      }
    }

    try {
      const upserted = await upsertSourceContent(db, {
        organizationId,
        userId,
        sourceType: 'youtube',
        externalId: videoId,
        title: titleHint ?? undefined,
        metadata: {
          originalUrl: youtubeUrl,
          youtube: {
            videoId
          }
        }
      })

      if (!upserted) {
        return {
          success: false,
          error: 'Failed to store source content'
        }
      }

      const ingested = await ingestYouTubeVideoAsSourceContent({
        db,
        sourceContentId: upserted.id,
        organizationId,
        userId,
        videoId
      })

      if (!ingested) {
        return {
          success: false,
          error: 'Failed to ingest YouTube video'
        }
      }

      return {
        success: true,
        result: {
          sourceContentId: ingested.id,
          ingestStatus: ingested.ingestStatus,
          sourceContent: {
            id: ingested.id,
            title: ingested.title,
            ingestStatus: ingested.ingestStatus
          }
        },
        sourceContentId: ingested.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to ingest YouTube video'
      }
    }
  }

  if (toolInvocation.name === 'save_transcript') {
    // TypeScript now knows this is save_transcript
    const args = toolInvocation.arguments as ChatToolInvocation<'save_transcript'>['arguments']
    const transcript = validateRequiredString(args.transcript, 'transcript')
    const title = validateOptionalString(args.title, 'title')

    try {
      const manualSource = await createSourceContentFromTranscript({
        db,
        organizationId,
        userId,
        transcript,
        title: title ?? null,
        metadata: { createdVia: 'chat_save_transcript_tool' },
        onProgress: async (progressMessage) => {
          await addMessageToChatSession(db, {
            sessionId,
            organizationId,
            role: 'assistant',
            content: progressMessage
          })
        }
      })

      if (!manualSource) {
        return {
          success: false,
          error: 'Failed to create source content from transcript'
        }
      }

      return {
        success: true,
        result: {
          sourceContentId: manualSource.id,
          ingestStatus: manualSource.ingestStatus,
          sourceContent: {
            id: manualSource.id,
            title: manualSource.title,
            ingestStatus: manualSource.ingestStatus
          }
        },
        sourceContentId: manualSource.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to save transcript'
      }
    }
  }

  if (toolInvocation.name === 'update_metadata') {
    // TypeScript now knows this is update_metadata
    const args = toolInvocation.arguments as ChatToolInvocation<'update_metadata'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')

    try {
      const [contentRecord] = await db
        .select()
        .from(schema.content)
        .where(and(
          eq(schema.content.id, contentId),
          eq(schema.content.organizationId, organizationId)
        ))
        .limit(1)

      if (!contentRecord) {
        return {
          success: false,
          error: 'Content not found'
        }
      }

      const updates: Record<string, any> = {
        updatedAt: new Date()
      }

      const updatedFields: string[] = []

      if (args.title !== undefined && args.title !== null) {
        const title = validateRequiredString(args.title, 'title')
        updates.title = title
        updatedFields.push('title')
      }

      if (args.slug !== undefined && args.slug !== null) {
        const slugInput = validateRequiredString(args.slug, 'slug')
        const baseSlug = slugifyTitle(slugInput)
        const slug = await ensureUniqueContentSlug(db, organizationId, baseSlug)
        updates.slug = slug
        updatedFields.push('slug')
      }

      if (args.status !== undefined && args.status !== null) {
        const statusValue = validateRequiredString(args.status, 'status')
        const status = validateEnum(statusValue, CONTENT_STATUSES, 'status')
        updates.status = status
        updatedFields.push('status')
      }

      if (args.primaryKeyword !== undefined && args.primaryKeyword !== null) {
        const primaryKeyword = validateOptionalString(args.primaryKeyword, 'primaryKeyword')
        updates.primaryKeyword = primaryKeyword
        updatedFields.push('primaryKeyword')
      }

      if (args.targetLocale !== undefined && args.targetLocale !== null) {
        const targetLocale = validateOptionalString(args.targetLocale, 'targetLocale')
        updates.targetLocale = targetLocale
        updatedFields.push('targetLocale')
      }

      if (args.contentType !== undefined && args.contentType !== null) {
        const contentTypeValue = validateRequiredString(args.contentType, 'contentType')
        const contentType = validateEnum(contentTypeValue, CONTENT_TYPES, 'contentType')
        updates.contentType = contentType
        updatedFields.push('contentType')
      }

      if (updatedFields.length === 0) {
        return {
          success: true,
          result: {
            contentId,
            updatedFields: []
          },
          contentId
        }
      }

      const [updatedContent] = await db
        .update(schema.content)
        .set(updates)
        .where(eq(schema.content.id, contentId))
        .returning()

      if (!updatedContent) {
        return {
          success: false,
          error: 'Failed to update content metadata'
        }
      }

      return {
        success: true,
        result: {
          contentId: updatedContent.id,
          updatedFields,
          content: {
            id: updatedContent.id,
            title: updatedContent.title,
            slug: updatedContent.slug,
            status: updatedContent.status,
            primaryKeyword: updatedContent.primaryKeyword,
            targetLocale: updatedContent.targetLocale,
            contentType: updatedContent.contentType
          }
        },
        contentId: updatedContent.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to update metadata'
      }
    }
  }

  if (toolInvocation.name === 'generate_content') {
    // TypeScript now knows this is generate_content
    const args = toolInvocation.arguments as ChatToolInvocation<'generate_content'>['arguments']

    try {
      let resolvedSourceContentId: string | null = args.sourceContentId ?? null
      const resolvedSourceText: string | null = args.sourceText ?? null

      // If sourceText/transcript is provided but no sourceContentId, create source content first
      if (resolvedSourceText && !resolvedSourceContentId) {
        const manualSource = await createSourceContentFromTranscript({
          db,
          organizationId,
          userId,
          transcript: resolvedSourceText,
          metadata: { createdVia: 'chat_generate_content_tool' },
          onProgress: async (progressMessage) => {
            await addMessageToChatSession(db, {
              sessionId,
              organizationId,
              role: 'assistant',
              content: progressMessage
            })
          }
        })

        if (!manualSource) {
          return {
            success: false,
            error: 'Failed to create source content from transcript'
          }
        }

        resolvedSourceContentId = manualSource.id
      }

      if (!resolvedSourceContentId && !resolvedSourceText) {
        return {
          success: false,
          error: 'Either sourceContentId or sourceText/transcript is required'
        }
      }

      let sanitizedSystemPrompt: string | undefined
      if (args.systemPrompt !== undefined && args.systemPrompt !== null) {
        const trimmed = validateRequiredString(args.systemPrompt, 'systemPrompt')
        sanitizedSystemPrompt = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed
      }

      let sanitizedTemperature = 1
      if (args.temperature !== undefined && args.temperature !== null) {
        sanitizedTemperature = validateNumber(args.temperature, 'temperature', 0, 2)
      }

      const generationResult = await generateContentDraftFromSource(db, {
        organizationId,
        userId,
        sourceContentId: resolvedSourceContentId ?? null,
        sourceText: resolvedSourceText,
        contentId: args.contentId ?? null,
        event: context.event,
        overrides: {
          title: args.title ? validateRequiredString(args.title, 'title') : null,
          slug: args.slug ? validateRequiredString(args.slug, 'slug') : null,
          status: args.status ? validateEnum(args.status, CONTENT_STATUSES, 'status') : undefined,
          primaryKeyword: args.primaryKeyword ? validateRequiredString(args.primaryKeyword, 'primaryKeyword') : null,
          targetLocale: args.targetLocale ? validateRequiredString(args.targetLocale, 'targetLocale') : null,
          contentType: args.contentType
            ? validateEnum(args.contentType, CONTENT_TYPES, 'contentType')
            : DEFAULT_CONTENT_TYPE
        },
        systemPrompt: sanitizedSystemPrompt,
        temperature: sanitizedTemperature
      })

      return {
        success: true,
        result: {
          contentId: generationResult.content.id,
          versionId: generationResult.version.id,
          content: {
            id: generationResult.content.id,
            title: generationResult.content.title,
            slug: generationResult.content.slug
          }
        },
        contentId: generationResult.content.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to generate content'
      }
    }
  }

  if (toolInvocation.name === 'patch_section') {
    // TypeScript now knows this is patch_section
    const args = toolInvocation.arguments as ChatToolInvocation<'patch_section'>['arguments']

    if (!args.contentId) {
      return {
        success: false,
        error: 'contentId is required for patch_section'
      }
    }

    if (!args.instructions) {
      return {
        success: false,
        error: 'instructions is required for patch_section'
      }
    }

    try {
      let sanitizedTemperature = 1
      if (args.temperature !== undefined && args.temperature !== null) {
        sanitizedTemperature = validateNumber(args.temperature, 'temperature', 0, 2)
      }

      const sectionId = args.sectionId ? validateRequiredString(args.sectionId, 'sectionId') : null
      if (!sectionId) {
        return {
          success: false,
          error: 'sectionId is required for patch_section'
        }
      }

      const patchResult = await updateContentSectionWithAI(db, {
        organizationId,
        userId,
        contentId: args.contentId,
        sectionId,
        instructions: args.instructions,
        temperature: sanitizedTemperature
      })

      return {
        success: true,
        result: {
          contentId: patchResult.content.id,
          versionId: patchResult.version.id,
          sectionId: patchResult.section?.id ?? null,
          content: {
            id: patchResult.content.id,
            title: patchResult.content.title
          }
        },
        contentId: patchResult.content.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to patch section'
      }
    }
  }

  if (toolInvocation.name === 're_enrich_content') {
    const args = toolInvocation.arguments as ChatToolInvocation<'re_enrich_content'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')
    const baseUrl = validateOptionalString(args.baseUrl, 'baseUrl')

    try {
      const { reEnrichContentVersion } = await import('~~/server/services/content/generation')
      const result = await reEnrichContentVersion(db, {
        organizationId,
        userId,
        contentId,
        baseUrl: baseUrl ?? undefined
      })

      return {
        success: true,
        result: {
          contentId: result.content.id,
          versionId: result.version.id,
          content: {
            id: result.content.id,
            title: result.content.title
          }
        },
        contentId: result.content.id
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to re-enrich content'
      }
    }
  }

  return {
    success: false,
    error: `Unknown tool: ${toolInvocation.name}`
  }
}

/**
 * Chat API endpoint - LLM-driven tool selection
 *
 * @description
 * This endpoint accepts natural language messages and uses an LLM agent to determine
 * which tools to execute. The agent can call multiple tools in sequence (multi-pass orchestration)
 * and will continue until it responds with text or reaches max iterations.
 *
 * **Key Features:**
 * - Natural language input - no need to construct action payloads
 * - Multi-pass orchestration - agent can chain multiple tool calls
 * - Automatic tool selection - agent chooses the right tool based on context
 * - Structured logging - tool_started, tool_succeeded, tool_failed logs for observability
 * - Error handling - automatic retries with configurable limits
 *
 * **Available Tools:**
 * - `ingest_youtube` - Fetch captions from YouTube videos
 * - `save_transcript` - Save pasted transcripts as source content
 * - `generate_content` - Create or update content drafts from sources
 * - `patch_section` - Update specific sections of existing drafts
 * - `update_metadata` - Update draft metadata (title, slug, status, etc.)
 *
 * @contract
 * **Input:**
 * ```typescript
 * {
 *   message: string (required) - Natural language user message
 *   sessionId?: string - Existing chat session ID to continue conversation
 *   contentId?: string - Content ID to link the session to (provides workspace context)
 * }
 * ```
 *
 * **Output:**
 * ```typescript
 * {
 *   assistantMessage: string - Final assistant response
 *   sessionId: string - Chat session ID
 *   sessionContentId: string | null - Linked content ID
 *   agentContext: {
 *     readySources: Array<{id, title, sourceType, ingestStatus}> - Sources ready for drafting
 *     ingestFailures: Array<{content, payload}> - Ingestion errors
 *     lastAction: string | null - Last successful tool/action name
 *     toolHistory: Array<{toolName, timestamp, status}> - Recent tool executions
 *   }
 *   messages: Array - All messages in the session
 *   logs: Array - All logs including tool_started, tool_succeeded, tool_failed
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Natural language request
 * POST /api/chat
 * {
 *   "message": "Create a draft from this YouTube video: https://youtube.com/watch?v=...",
 *   "sessionId": "abc-123"
 * }
 *
 * // The agent will automatically:
 * // 1. Call ingest_youtube tool to fetch captions
 * // 2. Call generate_content tool to create the draft
 * // 3. Return a friendly message confirming completion
 * ```
 *
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const db = await useDB(event)

  // Try to get organizationId from session first (faster and more reliable)
  const authSession = await getAuthSession(event)
  let organizationId: string | null = (authSession?.session as any)?.activeOrganizationId || null

  // If not in session, try to get from database via requireActiveOrganization
  if (!organizationId) {
    try {
      const orgResult = await requireActiveOrganization(event, user.id, { isAnonymousUser: user.isAnonymous ?? false })
      organizationId = orgResult.organizationId
    } catch (error: any) {
      // If user is anonymous and doesn't have an org yet, throw a helpful error
      if (user.isAnonymous) {
        throw createValidationError('Please create an account to use the chat feature. Anonymous users need an organization to continue.')
      }
      // For authenticated users, re-throw the error
      throw error
    }
  }

  if (!organizationId) {
    throw createValidationError('No active organization found. Please create an account or select an organization.')
  }

  const body = await readBody<ChatRequestBody>(event)

  validateRequestBody(body)

  const message = typeof body.message === 'string' ? body.message : ''
  const trimmedMessage = message.trim()
  const requestSessionId = body.sessionId ? validateOptionalUUID(body.sessionId, 'sessionId') : null

  if (!trimmedMessage) {
    throw createValidationError('Message is required')
  }

  const ingestionErrors: Array<{ content: string, payload?: Record<string, any> | null }> = []
  const readySources: typeof schema.sourceContent.$inferSelect[] = []
  const newlyReadySources: typeof schema.sourceContent.$inferSelect[] = []
  const readySourceIds = new Set<string>()
  let agentAssistantReply: string | null = null

  const trackReadySource = (
    source: typeof schema.sourceContent.$inferSelect | null | undefined,
    options?: { isNew?: boolean }
  ) => {
    if (!source || !source.id || source.ingestStatus !== 'ingested' || readySourceIds.has(source.id)) {
      return
    }

    readySources.push(source)
    readySourceIds.add(source.id)
    if (options?.isNew) {
      newlyReadySources.push(source)
    }
  }

  const requestContentId = (body as any).contentId
    ? validateOptionalUUID((body as any).contentId, 'contentId')
    : null

  // Determine session contentId from request
  const initialSessionContentId = requestContentId

  // Declare multiPassResult variable for use later
  let multiPassResult: Awaited<ReturnType<typeof runChatAgentWithMultiPass>> | null = null

  let session: typeof schema.contentChatSession.$inferSelect | null = null
  if (requestSessionId) {
    session = await getChatSessionById(db, requestSessionId, organizationId)
    if (!session) {
      console.warn(`Session ${requestSessionId} not found for organization ${organizationId}, creating new session`)
    }
  }

  if (!session) {
    const lastAction = trimmedMessage ? 'message' : null
    session = await getOrCreateChatSessionForContent(db, {
      organizationId,
      contentId: initialSessionContentId,
      sourceContentId: null, // Tools will set this when sources are created
      createdByUserId: user.id,
      metadata: {
        lastAction
      }
    })
  } else {
    // Update session metadata with last action if provided
    if (trimmedMessage) {
      const lastAction = 'message'
      const [updatedSession] = await db
        .update(schema.contentChatSession)
        .set({
          metadata: {
            ...(session.metadata as Record<string, any> || {}),
            lastAction
          },
          updatedAt: new Date()
        })
        .where(eq(schema.contentChatSession.id, session.id))
        .returning()
      if (updatedSession) {
        session = updatedSession
      }
    }
  }

  if (!session) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create chat session'
    })
  }

  // From this point on, session is guaranteed to be non-null
  // Use activeSession variable to avoid null checks
  let activeSession = session

  // Track any existing source content from the session
  if (activeSession.sourceContentId && !readySourceIds.has(activeSession.sourceContentId)) {
    const [sessionSource] = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.id, activeSession.sourceContentId),
        eq(schema.sourceContent.organizationId, organizationId)
      ))
      .limit(1)
    if (sessionSource) {
      trackReadySource(sessionSource)
    }
  }

  if (trimmedMessage) {
    const previousMessages = await getSessionMessages(db, activeSession.id, organizationId)
    const conversationHistory: ChatCompletionMessage[] = previousMessages.map(message => ({
      role: message.role === 'assistant'
        ? 'assistant'
        : message.role === 'system'
          ? 'system'
          : 'user',
      content: message.content
    }))

    const contextBlocks: string[] = []

    // Build workspace summary if content exists
    if (activeSession.contentId) {
      try {
        const [contentRecord] = await db
          .select()
          .from(schema.content)
          .where(and(
            eq(schema.content.id, activeSession.contentId),
            eq(schema.content.organizationId, organizationId)
          ))
          .limit(1)

        if (contentRecord) {
          const [versionRecord] = contentRecord.currentVersionId
            ? await db
                .select()
                .from(schema.contentVersion)
                .where(eq(schema.contentVersion.id, contentRecord.currentVersionId))
                .limit(1)
            : [null]

          if (versionRecord) {
            const [sourceRecord] = contentRecord.sourceContentId
              ? await db
                  .select()
                  .from(schema.sourceContent)
                  .where(and(
                    eq(schema.sourceContent.id, contentRecord.sourceContentId),
                    eq(schema.sourceContent.organizationId, organizationId)
                  ))
                  .limit(1)
              : [null]

            const workspaceSummary = buildWorkspaceSummary({
              content: contentRecord,
              currentVersion: versionRecord,
              sourceContent: sourceRecord ?? null
            })

            if (workspaceSummary) {
              contextBlocks.push(`Workspace Summary:\n${workspaceSummary}`)
            } else {
              contextBlocks.push(`Current draft: "${contentRecord.title}" (${contentRecord.status})`)
            }
          } else {
            contextBlocks.push(`Current draft ID: ${activeSession.contentId}`)
          }
        }
      } catch (error) {
        console.error('Failed to build workspace summary for context', error)
        contextBlocks.push(`Current draft ID: ${activeSession.contentId}`)
      }
    }

    // Add ready sources with details
    if (readySources.length > 0) {
      const sourceDetails = readySources.map((source) => {
        const title = source.title || 'Untitled source'
        const typeLabel = source.sourceType?.replace('_', ' ') || 'source'
        const status = source.ingestStatus === 'ingested' ? 'ready' : source.ingestStatus
        return `- ${title} (${typeLabel}, ${status})`
      }).join('\n')
      contextBlocks.push(`Ready sources for drafting:\n${sourceDetails}`)
    }

    // Add recent tool outcomes from session logs
    try {
      const recentLogs = await getSessionLogs(db, activeSession.id, organizationId)
      const toolLogs = recentLogs
        .filter(log => log.type && log.type.startsWith('tool_'))
        .slice(-5) // Last 5 tool logs
        .reverse()

      if (toolLogs.length > 0) {
        const toolSummary = toolLogs.map((log) => {
          const payload = log.payload as Record<string, any> | null
          const toolName = payload?.toolName || 'unknown'
          const status = log.type === 'tool_succeeded' ? 'succeeded' : log.type === 'tool_failed' ? 'failed' : 'started'
          return `- ${toolName}: ${status}`
        }).join('\n')
        contextBlocks.push(`Recent tool executions:\n${toolSummary}`)
      }
    } catch (error) {
      console.error('Failed to load recent tool logs for context', error)
    }

    // Add ingestion failures if any
    if (ingestionErrors.length > 0) {
      const failureSummary = ingestionErrors.map(err => `- ${err.content}`).join('\n')
      contextBlocks.push(`Ingestion failures:\n${failureSummary}`)
    }

    try {
      // Multi-pass orchestration - handles all tools directly
      multiPassResult = await runChatAgentWithMultiPass({
        conversationHistory,
        userMessage: trimmedMessage,
        contextBlocks,
        onRetry: async (toolInvocation: ChatToolInvocation, retryCount: number) => {
          // Log tool retry
          await addLogEntryToChatSession(db, {
            sessionId: activeSession.id,
            organizationId,
            type: 'tool_retrying',
            message: `Retrying ${toolInvocation.name} (attempt ${retryCount + 1}/3)...`,
            payload: {
              toolName: toolInvocation.name,
              args: toolInvocation.arguments,
              retryCount
            }
          })
        },
        executeTool: async (toolInvocation: ChatToolInvocation) => {
          // Log tool start
          await addLogEntryToChatSession(db, {
            sessionId: activeSession.id,
            organizationId,
            type: 'tool_started',
            message: `Running ${toolInvocation.name}...`,
            payload: {
              toolName: toolInvocation.name,
              args: toolInvocation.arguments
            }
          })
          return await executeChatTool(toolInvocation, {
            db,
            organizationId,
            userId: user.id,
            sessionId: activeSession.id,
            event
          })
        }
      })

      // Process multi-pass results
      if (multiPassResult.toolHistory.length > 0) {
        // Update session with any new sources or content created
        for (const toolExec of multiPassResult.toolHistory) {
          if (toolExec.result.success && toolExec.result.sourceContentId) {
            const newSourceId = toolExec.result.sourceContentId
            // Update session with new source if different from current
            if (activeSession.sourceContentId !== newSourceId) {
              const [updatedSession] = await db
                .update(schema.contentChatSession)
                .set({ sourceContentId: newSourceId })
                .where(eq(schema.contentChatSession.id, activeSession.id))
                .returning()
              if (updatedSession) {
                activeSession = updatedSession
              }
            }
            // Track ready source
            const [sourceRecord] = await db
              .select()
              .from(schema.sourceContent)
              .where(and(
                eq(schema.sourceContent.id, newSourceId),
                eq(schema.sourceContent.organizationId, organizationId)
              ))
              .limit(1)
            if (sourceRecord) {
              trackReadySource(sourceRecord, { isNew: true })
            }
          }
          // Update session with new content if generate_content or patch_section succeeded
          if (toolExec.result.success && toolExec.result.contentId) {
            const newContentId = toolExec.result.contentId
            if (activeSession.contentId !== newContentId) {
              const [updatedSession] = await db
                .update(schema.contentChatSession)
                .set({
                  contentId: newContentId,
                  metadata: {
                    ...(activeSession.metadata as Record<string, any> || {}),
                    linkedContentId: newContentId,
                    linkedAt: new Date().toISOString()
                  },
                  updatedAt: new Date()
                })
                .where(eq(schema.contentChatSession.id, activeSession.id))
                .returning()
              if (updatedSession) {
                activeSession = updatedSession
              }
            }
          }

          // Log tool execution
          await addLogEntryToChatSession(db, {
            sessionId: activeSession.id,
            organizationId,
            type: toolExec.result.success ? 'tool_succeeded' : 'tool_failed',
            message: toolExec.result.success
              ? `Tool ${toolExec.toolName} executed successfully`
              : `Tool ${toolExec.toolName} failed: ${toolExec.result.error || 'Unknown error'}`,
            payload: {
              toolName: toolExec.toolName,
              args: toolExec.invocation.arguments,
              result: toolExec.result.result,
              error: toolExec.result.error
            }
          })

          // Update session metadata with last successful tool
          if (toolExec.result.success) {
            const [updatedSession] = await db
              .update(schema.contentChatSession)
              .set({
                metadata: {
                  ...(activeSession.metadata as Record<string, any> || {}),
                  lastAction: toolExec.toolName,
                  lastToolSuccess: new Date().toISOString()
                },
                updatedAt: new Date()
              })
              .where(eq(schema.contentChatSession.id, activeSession.id))
              .returning()
            if (updatedSession) {
              activeSession = updatedSession
            }
          }
        }
        if (multiPassResult.finalMessage) {
          agentAssistantReply = multiPassResult.finalMessage
        }
      } else {
        if (multiPassResult.finalMessage) {
          agentAssistantReply = multiPassResult.finalMessage
        }
      }
    } catch (error) {
      console.error('Agent turn failed', error)
      ingestionErrors.push({
        content: 'The assistant encountered an error processing your request. Please try again.',
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          type: 'agent_failure'
        }
      })
    }
  }

  for (const errorMessage of ingestionErrors) {
    await addMessageToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      role: 'assistant',
      content: errorMessage.content,
      payload: errorMessage.payload ?? null
    })
  }

  // Check if any tools created content that needs completion messages
  let completionMessages: Awaited<ReturnType<typeof composeWorkspaceCompletionMessages>> | null = null
  if (multiPassResult && multiPassResult.toolHistory.length > 0) {
    // Find generate_content or patch_section results
    for (const toolExec of multiPassResult.toolHistory) {
      if (toolExec.result.success && toolExec.result.contentId) {
        try {
          const [contentRecord] = await db
            .select()
            .from(schema.content)
            .where(and(
              eq(schema.content.id, toolExec.result.contentId),
              eq(schema.content.organizationId, organizationId)
            ))
            .limit(1)

          if (contentRecord && contentRecord.currentVersionId) {
            const [versionRecord] = await db
              .select()
              .from(schema.contentVersion)
              .where(eq(schema.contentVersion.id, contentRecord.currentVersionId))
              .limit(1)

            if (versionRecord) {
              completionMessages = await composeWorkspaceCompletionMessages(
                db,
                organizationId,
                contentRecord,
                versionRecord
              )
              break // Use first successful result
            }
          }
        } catch (error) {
          console.error('Failed to build completion messages', error)
        }
      }
    }
  }

  if (trimmedMessage) {
    await addMessageToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      role: 'user',
      content: trimmedMessage
    })
    await addLogEntryToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      type: 'user_message',
      message: 'User sent a chat prompt'
    })
  }

  const sessionMessages = await getSessionMessages(db, activeSession.id, organizationId)
  const conversationHistory: ChatCompletionMessage[] = sessionMessages.map(message => ({
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    content: message.content
  }))

  // Build context for LLM to generate a single coherent assistant message
  const contextParts: string[] = []

  // Add information about ready sources (ingested and ready for drafting)
  if (readySources.length > 0) {
    for (const source of readySources) {
      const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : null
      const typeLabel = source.sourceType?.replace('_', ' ') || 'source'
      const intro = title ? `${title} (${typeLabel})` : typeLabel
      contextParts.push(`Source ready for drafting: ${intro}.`)
    }
  }

  // Check if any tools created content (from multiPassResult)
  if (multiPassResult) {
    const contentTools = multiPassResult.toolHistory.filter(t =>
      t.result.success &&
      (t.toolName === 'generate_content' || t.toolName === 'patch_section') &&
      t.result.contentId
    )
    if (contentTools.length > 0) {
      contextParts.push('Content has been successfully created or updated and is ready for review.')
    }
  }

  const shouldSkipAssistantResponse = Boolean(agentAssistantReply)

  // Generate a single coherent assistant message using LLM
  let assistantMessageBody = ''
  if (shouldSkipAssistantResponse) {
    assistantMessageBody = agentAssistantReply || ''
  } else if (contextParts.length > 0 || trimmedMessage) {
    const { callChatCompletions } = await import('~~/server/utils/aiGateway')
    const contextText = contextParts.length > 0 ? `Context:\n${contextParts.join('\n\n')}` : ''
    const userMessage = wrapPromptSnippet('User message', trimmedMessage, 1500) || 'User sent a message.'

    const prompt = `${contextText}

${userMessage}

Generate a friendly, conversational assistant response that:
1. Acknowledges what happened (sources processed, drafts created, sections updated, etc.)
2. Offers next steps (creating drafts, editing sections, etc.)
3. Is concise (2-4 sentences) and natural
4. Explicitly offers to create blog drafts when sources are ready

Keep it conversational and helpful.`

    try {
      assistantMessageBody = await callChatCompletions({
        messages: [
          { role: 'system', content: 'You are a helpful content creation assistant. You help users create blog drafts from sources like YouTube videos and transcripts. Be friendly, concise, and always offer to create drafts when sources are ready.' },
          ...conversationHistory,
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        maxTokens: 300
      })
    } catch (error) {
      console.error('Failed to generate assistant message with LLM', error)
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to generate assistant response'
      })
    }
  } else {
    assistantMessageBody = 'Got it. I\'m ready whenever you want to start a draft or share a link.'
  }

  if (assistantMessageBody) {
    await addMessageToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      role: 'assistant',
      content: assistantMessageBody
    })
  }

  if (completionMessages?.summary) {
    await addMessageToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.summary.content,
      payload: completionMessages.summary.payload
    })
  }

  if (completionMessages?.files) {
    await addMessageToChatSession(db, {
      sessionId: activeSession.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.files.content,
      payload: completionMessages.files.payload
    })
  }

  const messages = await getSessionMessages(db, activeSession.id, organizationId)
  const logs = await getSessionLogs(db, activeSession.id, organizationId)

  // Build tool history from logs
  const toolHistory = logs
    .filter(log => log.type && log.type.startsWith('tool_'))
    .map((log) => {
      const payload = log.payload as Record<string, any> | null
      let status = 'unknown'
      if (log.type === 'tool_succeeded') {
        status = 'succeeded'
      } else if (log.type === 'tool_failed') {
        status = 'failed'
      } else if (log.type === 'tool_started') {
        status = 'started'
      } else if (log.type === 'tool_retrying') {
        status = 'retrying'
      }
      return {
        toolName: payload?.toolName || 'unknown',
        timestamp: log.createdAt,
        status
      }
    })
    .slice(-10) // Last 10 tool executions

  // Get last action from session metadata
  const lastAction = (activeSession.metadata as Record<string, any> | null)?.lastAction || null

  // Build agentContext
  const agentContext = {
    readySources: readySources.map(source => ({
      id: source.id,
      title: source.title,
      sourceType: source.sourceType,
      ingestStatus: source.ingestStatus,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt
    })),
    ingestFailures: ingestionErrors.map(err => ({
      content: err.content,
      payload: err.payload
    })),
    lastAction,
    toolHistory
  }

  return {
    assistantMessage: assistantMessageBody,
    sources: [],
    generation: null,
    sessionId: activeSession.id,
    sessionContentId: activeSession.contentId ?? null,
    agentContext,
    messages: messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      payload: message.payload
    })),
    logs: logs.map(log => ({
      id: log.id,
      type: log.type,
      message: log.message,
      payload: log.payload,
      createdAt: log.createdAt
    }))
  }
})
