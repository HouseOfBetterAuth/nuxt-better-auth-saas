import type { ChatToolInvocation } from '~~/server/services/chat/tools'
import type { ChatRequestBody } from '~~/server/types/api'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { and, eq } from 'drizzle-orm'
import { createError, setHeader, setResponseStatus } from 'h3'
import * as schema from '~~/server/database/schema'
import { runChatAgentWithMultiPassStream } from '~~/server/services/chat/agent'
import { generateContentFromSource, updateContentSection } from '~~/server/services/content/generation'
import { buildWorkspaceFilesPayload } from '~~/server/services/content/workspaceFiles'
import { buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import {
  addLogEntryToConversation,
  addMessageToConversation,
  getConversationById,
  getConversationLogs,
  getConversationMessages,
  getOrCreateConversationForContent
} from '~~/server/services/conversation'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { ingestYouTubeVideoAsSourceContent } from '~~/server/services/sourceContent/youtubeIngest'
import { ensureConversationCapacity, getAuthSession, requireAuth } from '~~/server/utils/auth'
import { extractYouTubeId } from '~~/server/utils/chat'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, slugifyTitle } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateEnum, validateNumber, validateOptionalString, validateOptionalUUID, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'
import { DEFAULT_CONTENT_TYPE } from '~~/shared/constants/contentTypes'

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

function writeSSEEvent(event: any, eventType: string, data: any) {
  let eventData: string
  try {
    eventData = JSON.stringify(data)
  } catch (error) {
    console.error('Failed to serialize SSE data:', error)
    eventData = JSON.stringify({ error: 'Serialization failed' })
  }
  return `event: ${eventType}\ndata: ${eventData}\n\n`
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
  const summaryText = ['**Summary**', ...(summaryBullets.length ? summaryBullets : ['Content updated.']).map(item => `- ${item}`)].join('\n')
  const filesPayload = buildWorkspaceFilesPayload(content, version, sourceContent)
  const filesText = ['**Files**', ...filesPayload.map(file => `- ${file.filename}`)].join('\n')

  return {
    summary: {
      content: summaryText,
      payload: {
        type: 'workspace_summary',
        summary: workspaceSummary || 'Content updated.'
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

async function logToolEvent(
  db: Awaited<ReturnType<typeof useDB>>,
  conversationId: string,
  organizationId: string,
  type: 'tool_started' | 'tool_retrying',
  toolName: string,
  args?: any,
  retryCount?: number,
  writeSSE?: (eventType: string, data: any) => void
) {
  const message = type === 'tool_retrying'
    ? `Retrying ${toolName} (attempt ${(retryCount ?? 0) + 1}/3)...`
    : `Running ${toolName}...`

  const logEntry = await addLogEntryToConversation(db, {
    conversationId,
    organizationId,
    type,
    message,
    payload: { toolName, args, retryCount }
  })

  if (writeSSE && logEntry) {
    writeSSE('log:entry', {
      id: logEntry.id,
      type: logEntry.type,
      message: logEntry.message,
      payload: logEntry.payload,
      createdAt: logEntry.createdAt
    })
  }

  if (type === 'tool_started' && writeSSE) {
    writeSSE('tool:start', {
      toolName,
      timestamp: new Date().toISOString()
    })
  }

  return logEntry
}

async function executeChatTool(
  toolInvocation: ChatToolInvocation,
  context: {
    db: Awaited<ReturnType<typeof useDB>>
    organizationId: string
    userId: string
    conversationId: string
    event: any
  }
): Promise<ToolExecutionResult> {
  const { db, organizationId, userId, conversationId } = context

  if (toolInvocation.name === 'fetch_youtube') {
    // TypeScript now knows this is fetch_youtube
    const args = toolInvocation.arguments as ChatToolInvocation<'fetch_youtube'>['arguments']
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

  if (toolInvocation.name === 'save_source') {
    // TypeScript now knows this is save_source
    const args = toolInvocation.arguments as ChatToolInvocation<'save_source'>['arguments']
    const transcript = validateRequiredString(args.transcript, 'transcript')
    const title = validateOptionalString(args.title, 'title')

    try {
      const manualSource = await createSourceContentFromTranscript({
        db,
        organizationId,
        userId,
        transcript,
        title: title ?? null,
        metadata: { createdVia: 'chat_save_source_tool' },
        onProgress: async (progressMessage) => {
          await addMessageToConversation(db, {
            conversationId,
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

  if (toolInvocation.name === 'edit_metadata') {
    // TypeScript now knows this is edit_metadata
    const args = toolInvocation.arguments as ChatToolInvocation<'edit_metadata'>['arguments']
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

  if (toolInvocation.name === 'write_content') {
    // TypeScript now knows this is write_content
    const args = toolInvocation.arguments as ChatToolInvocation<'write_content'>['arguments']

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
          metadata: { createdVia: 'chat_write_content_tool' },
          onProgress: async (progressMessage) => {
            await addMessageToConversation(db, {
              conversationId,
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

      const generationResult = await generateContentFromSource(db, {
        organizationId,
        userId,
        sourceContentId: resolvedSourceContentId ?? null,
        sourceText: resolvedSourceText,
        contentId: null, // write_content only creates new content, never updates existing ones
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

  if (toolInvocation.name === 'edit_section') {
    // TypeScript now knows this is edit_section
    const args = toolInvocation.arguments as ChatToolInvocation<'edit_section'>['arguments']

    if (!args.contentId) {
      return {
        success: false,
        error: 'contentId is required for edit_section'
      }
    }

    if (!args.instructions) {
      return {
        success: false,
        error: 'instructions is required for edit_section'
      }
    }

    try {
      let sanitizedTemperature = 1
      if (args.temperature !== undefined && args.temperature !== null) {
        sanitizedTemperature = validateNumber(args.temperature, 'temperature', 0, 2)
      }

      // Resolve sectionId from either sectionId or sectionTitle
      let resolvedSectionId: string | null = null

      if (args.sectionId) {
        resolvedSectionId = validateRequiredString(args.sectionId, 'sectionId')
      } else if (args.sectionTitle) {
        const sectionTitle = validateRequiredString(args.sectionTitle, 'sectionTitle')

        // Query content version to find section by title
        const [contentRecord] = await db
          .select({
            version: schema.contentVersion
          })
          .from(schema.content)
          .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
          .where(and(
            eq(schema.content.organizationId, organizationId),
            eq(schema.content.id, args.contentId)
          ))
          .limit(1)

        if (!contentRecord?.version) {
          return {
            success: false,
            error: 'Content version not found'
          }
        }

        // Normalize sections to find by title
        const sectionsData = contentRecord.version.sections
        if (Array.isArray(sectionsData)) {
          const matchingSection = sectionsData.find((section: any) => {
            const sectionTitleValue = section?.title || section?.section_title
            return typeof sectionTitleValue === 'string' && sectionTitleValue.trim().toLowerCase() === sectionTitle.trim().toLowerCase()
          })

          if (matchingSection) {
            resolvedSectionId = matchingSection.id || matchingSection.section_id || null
          }
        }

        if (!resolvedSectionId) {
          return {
            success: false,
            error: `Section with title "${sectionTitle}" not found in this content`
          }
        }
      } else {
        return {
          success: false,
          error: 'Either sectionId or sectionTitle is required for edit_section'
        }
      }

      const patchResult = await updateContentSection(db, {
        organizationId,
        userId,
        contentId: args.contentId,
        sectionId: resolvedSectionId,
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

  if (toolInvocation.name === 'enrich_content') {
    const args = toolInvocation.arguments as ChatToolInvocation<'enrich_content'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')
    const baseUrl = validateOptionalString(args.baseUrl, 'baseUrl')

    try {
      const { refreshContentVersionMetadata } = await import('~~/server/services/content/generation')
      const result = await refreshContentVersionMetadata(db, {
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
 * - `fetch_youtube` - Fetch captions from YouTube videos
 * - `save_source` - Save pasted transcripts as source content
 * - `write_content` - Create new content items from sources
 * - `edit_section` - Update specific sections of existing content
 * - `edit_metadata` - Update content metadata (title, slug, status, etc.)
 *
 * @contract
 * **Input:**
 * ```typescript
 * {
 *   message: string (required) - Natural language user message
 *   conversationId?: string - Existing conversation ID to continue conversation
 *   contentId?: string - Content ID to link the session to (provides workspace context)
 * }
 * ```
 *
 * **Output (SSE Stream):**
 * This endpoint returns a Server-Sent Events (SSE) stream with the following events:
 *
 * - `conversation:update` - Conversation state changes (conversationId, conversationContentId)
 * - `message:chunk` - Incremental LLM text chunks (`{ messageId: string, chunk: string }`)
 * - `message:complete` - LLM text generation finished (`{ messageId: string, message: string }`)
 * - `tool:start` - Tool execution started (`{ toolName: string, timestamp: string }`)
 * - `tool:complete` - Tool execution completed (`{ toolName, success, result, error, timestamp }`)
 * - `log:entry` - Log entries (`{ id, type, message, payload, createdAt }`)
 * - `messages:complete` - **Authoritative message list from database** (`{ messages: Array }`)
 * - `logs:complete` - Authoritative log list from database (`{ logs: Array }`)
 * - `agentContext:update` - Final agent context (`{ readySources, ingestFailures, lastAction, toolHistory }`)
 * - `conversation:final` - Final conversation state (`{ conversationId, conversationContentId }`)
 * - `done` - Stream completion signal (`{}`)
 *
 * **Important:** The `messages:complete` event contains the authoritative, DB-backed message list.
 * Clients must replace their local messages array with this snapshot.
 *
 * @example
 * ```typescript
 * // Natural language request
 * POST /api/chat
 * {
 *   "message": "Create content from this YouTube video: https://youtube.com/watch?v=...",
 *   "conversationId": "abc-123"
 * }
 *
 * // The agent will automatically:
 * // 1. Call fetch_youtube tool to fetch captions
 * // 2. Call write_content tool to create the content
 * // 3. Return a friendly message confirming completion
 * ```
 *
 */
/**
 * Chat API endpoint - Streaming-only (SSE)
 *
 * This endpoint is designed for server-driven streaming in the Cursor/Codex style:
 * - Server is the single source of truth (DB-backed)
 * - Server streams message chunks as LLM generates text
 * - Client shows temporary assistant message keyed by server-generated messageId
 * - After tools + DB writes, server emits messages:complete with authoritative message list
 * - Client replaces its messages with that snapshot
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const db = await useDB(event)

  // Try to get organizationId from session first (faster and more reliable)
  const authSession = await getAuthSession(event)
  let organizationId: string | null = (authSession?.session as any)?.activeOrganizationId || null

  // Verify organization exists if we got it from session
  if (organizationId) {
    const [orgExists] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (!orgExists) {
      // Organization from session doesn't exist (e.g., was deleted), clear it
      organizationId = null
    }
  }

  // If not in session or organization doesn't exist, try to get from database via requireActiveOrganization
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
  // Support both conversationId (new) and sessionId (legacy) for backwards compatibility
  const requestConversationId = body.conversationId
    ? validateOptionalUUID(body.conversationId, 'conversationId')
    : body.sessionId
      ? validateOptionalUUID(body.sessionId, 'sessionId')
      : null

  if (!trimmedMessage) {
    throw createValidationError('Message is required')
  }

  // Set SSE headers for streaming response
  setResponseStatus(event, 200)
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'X-Accel-Buffering', 'no') // Disable nginx buffering

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
  const _initialSessionContentId = requestContentId

  // Declare multiPassResult variable for use later
  let multiPassResult: Awaited<ReturnType<typeof runChatAgentWithMultiPassStream>> | null = null

  let conversation: typeof schema.conversation.$inferSelect | null = null
  if (requestSessionId) {
    conversation = await getConversationById(db, requestConversationId, organizationId)
    if (!conversation) {
      console.warn(`Conversation ${requestConversationId} not found for organization ${organizationId}, creating new conversation`)
    }
  }

  if (!conversation) {
    // Check conversation quota before creating a new conversation
    await ensureConversationCapacity(db, organizationId, user, event)

    const lastAction = trimmedMessage ? 'message' : null
    conversation = await getOrCreateConversationForContent(db, {
      organizationId,
      contentId: initialConversationContentId ?? null, // Explicitly null if undefined
      sourceContentId: null, // Tools will set this when sources are created
      createdByUserId: user.id,
      metadata: {
        lastAction
      }
    })
  } else {
    // Update conversation metadata with last action if provided
    if (trimmedMessage) {
      const lastAction = 'message'
      const [updatedConversation] = await db
        .update(schema.conversation)
        .set({
          metadata: {
            ...(conversation.metadata as Record<string, any> || {}),
            lastAction
          },
          updatedAt: new Date()
        })
        .where(eq(schema.conversation.id, conversation.id))
        .returning()
      if (updatedConversation) {
        conversation = updatedConversation
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
  // Use activeConversation variable to avoid null checks
  let activeConversation = conversation

  // Helper to write SSE event to response stream
  const writeSSE = (eventType: string, data: any) => {
    try {
      const sseData = writeSSEEvent(event, eventType, data)
      event.node.res.write(sseData)
    } catch (error) {
      console.error('Failed to write SSE event:', error)
    }
  }

  // Track message ID for current streaming assistant message
  // Server generates UUID on first chunk, uses same ID for all chunks and DB save
  // This ensures the client-side message ID matches the server-side message ID
  let currentMessageId: string | null = null

  // Track any existing source content from the conversation
  if (activeConversation.sourceContentId && !readySourceIds.has(activeConversation.sourceContentId)) {
    const [conversationSource] = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.id, activeConversation.sourceContentId),
        eq(schema.sourceContent.organizationId, organizationId)
      ))
      .limit(1)
    if (conversationSource) {
      trackReadySource(conversationSource)
    }
  }

  if (trimmedMessage) {
    const previousMessages = await getConversationMessages(db, activeConversation.id, organizationId)
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
    if (activeConversation.contentId) {
      try {
        const [contentRecord] = await db
          .select()
          .from(schema.content)
          .where(and(
            eq(schema.content.id, activeConversation.contentId),
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
              contextBlocks.push(`Current content: "${contentRecord.title}" (${contentRecord.status})`)
            }
          } else {
            contextBlocks.push(`Current content ID: ${activeConversation.contentId}`)
          }
        }
      } catch (error) {
        console.error('Failed to build workspace summary for context', error)
        contextBlocks.push(`Current content ID: ${activeConversation.contentId}`)
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
      contextBlocks.push(`Ready sources for content generation:\n${sourceDetails}`)
    }

    // Add recent tool outcomes from session logs
    try {
      const recentLogs = await getConversationLogs(db, activeConversation.id, organizationId)
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

    // Import crypto for UUID generation for streaming message IDs
    const { randomUUID } = await import('crypto')

    try {
      // Streaming multi-pass orchestration - handles all tools directly
      // Track assistant message for potential future use (used in callbacks)
      let _currentAssistantMessage = ''

      // Send initial conversation update
      // Event: conversation:update - Emitted when conversation state changes (e.g., conversation created, contentId updated)
      // Client should update conversationId and conversationContentId state
      writeSSE('conversation:update', {
        conversationId: activeConversation.id,
        conversationContentId: activeConversation.contentId
      })

      multiPassResult = await runChatAgentWithMultiPassStream({
        conversationHistory,
        userMessage: trimmedMessage,
        contextBlocks,
        onLLMChunk: (chunk: string) => {
          _currentAssistantMessage += chunk
          if (!currentMessageId) {
            currentMessageId = randomUUID()
          }
          // Event: message:chunk - Incremental text chunks from LLM during current turn
          // Client should create temporary assistant message on first chunk (using server messageId)
          // and update its content as chunks arrive
          writeSSE('message:chunk', {
            messageId: currentMessageId,
            chunk
          })
        },
        onToolStart: async (toolName: string) => {
          // Log tool start to database
          await logToolEvent(
            db,
            activeConversation.id,
            organizationId,
            'tool_started',
            toolName,
            undefined,
            undefined,
            writeSSE
          )
        },
        onToolComplete: async (toolName: string, result: any) => {
          // Event: tool:complete - Tool execution finished for current turn
          // Client should update UI to reflect tool completion status
          writeSSE('tool:complete', {
            toolName,
            success: result.success,
            result: result.result,
            error: result.error,
            timestamp: new Date().toISOString()
          })
        },
        onFinalMessage: (message: string) => {
          _currentAssistantMessage = message
          // Event: message:complete - LLM text generation finished for current turn (before DB snapshot)
          // This is an intermediate signal; the authoritative message list comes in messages:complete
          writeSSE('message:complete', {
            messageId: currentMessageId,
            message
          })
        },
        onRetry: async (toolInvocation: ChatToolInvocation, retryCount: number) => {
          // Log tool retry to database
          await logToolEvent(
            db,
            activeConversation.id,
            organizationId,
            'tool_retrying',
            toolInvocation.name,
            toolInvocation.arguments,
            retryCount,
            writeSSE
          )
        },
        executeTool: async (toolInvocation: ChatToolInvocation) => {
          return await executeChatTool(toolInvocation, {
            db,
            organizationId,
            userId: user.id,
            conversationId: activeConversation.id,
            event
          })
        }
      })

      // Process multi-pass results
      if (multiPassResult.toolHistory.length > 0) {
        // Update conversation with any new sources or content created
        for (const toolExec of multiPassResult.toolHistory) {
          if (toolExec.result.success && toolExec.result.sourceContentId) {
            const newSourceId = toolExec.result.sourceContentId
            // Update conversation with new source if different from current
            if (activeConversation.sourceContentId !== newSourceId) {
              const [updatedConversation] = await db
                .update(schema.conversation)
                .set({ sourceContentId: newSourceId })
                .where(eq(schema.conversation.id, activeConversation.id))
                .returning()
              if (updatedConversation) {
                activeConversation = updatedConversation
                writeSSE('conversation:update', {
                  conversationId: activeConversation.id,
                  conversationContentId: activeConversation.contentId
                })
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
          // Update conversation with new content if write_content or edit_section succeeded
          if (toolExec.result.success && toolExec.result.contentId) {
            const newContentId = toolExec.result.contentId
            if (activeConversation.contentId !== newContentId) {
              const [updatedConversation] = await db
                .update(schema.conversation)
                .set({
                  contentId: newContentId,
                  metadata: {
                    ...(activeConversation.metadata as Record<string, any> || {}),
                    linkedContentId: newContentId,
                    linkedAt: new Date().toISOString()
                  },
                  updatedAt: new Date()
                })
                .where(eq(schema.conversation.id, activeConversation.id))
                .returning()
              if (updatedConversation) {
                activeConversation = updatedConversation
                writeSSE('conversation:update', {
                  conversationId: activeConversation.id,
                  conversationContentId: activeConversation.contentId
                })
              }
            }
          }

          // Log tool execution
          const logEntry = await addLogEntryToConversation(db, {
            conversationId: activeConversation.id,
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

          // Event: log:entry - Log entry added to database (tool_started, tool_succeeded, tool_failed, etc.)
          // Client should append to logs array for UI display
          if (logEntry) {
            writeSSE('log:entry', {
              id: logEntry.id,
              type: logEntry.type,
              message: logEntry.message,
              payload: logEntry.payload,
              createdAt: logEntry.createdAt
            })
          }

          // Update conversation metadata with last successful tool
          if (toolExec.result.success) {
            const [updatedConversation] = await db
              .update(schema.conversation)
              .set({
                metadata: {
                  ...(activeConversation.metadata as Record<string, any> || {}),
                  lastAction: toolExec.toolName,
                  lastToolSuccess: new Date().toISOString()
                },
                updatedAt: new Date()
              })
              .where(eq(schema.conversation.id, activeConversation.id))
              .returning()
            if (updatedConversation) {
              activeConversation = updatedConversation
            }
          }
        }
      }
      if (multiPassResult.finalMessage) {
        agentAssistantReply = multiPassResult.finalMessage
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
    await addMessageToConversation(db, {
      conversationId: activeConversation.id,
      organizationId,
      role: 'assistant',
      content: errorMessage.content,
      payload: errorMessage.payload ?? null
    })
  }

  // Check if any tools created content that needs completion messages
  let completionMessages: Awaited<ReturnType<typeof composeWorkspaceCompletionMessages>> | null = null
  if (multiPassResult && multiPassResult.toolHistory.length > 0) {
    // Find write_content or edit_section results
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
    await addMessageToConversation(db, {
      conversationId: activeConversation.id,
      organizationId,
      role: 'user',
      content: trimmedMessage
    })
    await addLogEntryToConversation(db, {
      conversationId: activeConversation.id,
      organizationId,
      type: 'user_message',
      message: 'User sent a chat prompt'
    })
  }

  // Save agent's reply if available (use the same message ID from streaming to avoid duplicates)
  if (agentAssistantReply) {
    await addMessageToConversation(db, {
      id: currentMessageId || undefined, // Use streaming message ID to match client-side message
      conversationId: activeConversation.id,
      organizationId,
      role: 'assistant',
      content: agentAssistantReply
    })
  }

  if (completionMessages?.summary) {
    await addMessageToConversation(db, {
      conversationId: activeConversation.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.summary.content,
      payload: completionMessages.summary.payload
    })
  }

  if (completionMessages?.files) {
    await addMessageToConversation(db, {
      conversationId: activeConversation.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.files.content,
      payload: completionMessages.files.payload
    })
  }

  const messages = await getConversationMessages(db, activeConversation.id, organizationId)
  const logs = await getConversationLogs(db, activeConversation.id, organizationId)

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
  const lastAction = (activeConversation.metadata as Record<string, any> | null)?.lastAction || null

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

  // Write final authoritative state as SSE events
  // These events represent the committed database state after all processing
  const finalMessages = messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    payload: message.payload
  }))

  const finalLogs = logs.map(log => ({
    id: log.id,
    type: log.type,
    message: log.message,
    payload: log.payload,
    createdAt: log.createdAt
  }))

  // Event: messages:complete - Authoritative message list from database
  // This is the single source of truth. Client MUST replace its messages array with this snapshot
  // and clear all temporary streaming state (currentAssistantMessageId, currentAssistantMessageText, etc.)
  writeSSE('messages:complete', {
    messages: finalMessages
  })

  // Event: logs:complete - Authoritative log list from database
  // Client should replace its logs array with this snapshot
  writeSSE('logs:complete', {
    logs: finalLogs
  })

  // Event: agentContext:update - Final agent context (readySources, ingestFailures, lastAction, toolHistory)
  // Client should update agentContext state with this data
  writeSSE('agentContext:update', agentContext)

  // Event: session:final - Final session state after all processing
  // Client should update conversationId and conversationContentId with final values
  writeSSE('conversation:final', {
    conversationId: activeConversation.id,
    conversationContentId: activeConversation.contentId
  })

  // Event: done - Stream completion signal
  // Client should treat stream as complete. If messages:complete was not received, treat as error.
  writeSSE('done', {})
  event.node.res.end()

  // Return null (response already sent via SSE stream)
  return null
})
