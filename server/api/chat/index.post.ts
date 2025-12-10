import type { ChatToolInvocation } from '~~/server/services/chat/tools'
import type { ChatRequestBody } from '~~/server/types/api'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { createError, setHeader, setResponseStatus } from 'h3'
import * as schema from '~~/server/database/schema'
import { runChatAgentWithMultiPassStream } from '~~/server/services/chat/agent'
import { generateContentFromSource, updateContentSection } from '~~/server/services/content/generation'
import { buildWorkspaceFilesPayload } from '~~/server/services/content/workspaceFiles'
import { buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import {
  addLogEntryToConversation,
  addMessageToConversation,
  createConversation,
  getConversationById,
  getConversationLogs,
  getConversationMessages
} from '~~/server/services/conversation'
import { generateConversationTitle } from '~~/server/services/conversation/title'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createSourceContentFromContext } from '~~/server/services/sourceContent/manualTranscript'
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

  return logEntry
}

async function executeChatTool(
  toolInvocation: ChatToolInvocation,
  context: {
    mode: 'chat' | 'agent'
    db: Awaited<ReturnType<typeof useDB>>
    organizationId: string
    userId: string
    conversationId: string
    event: any
  }
): Promise<ToolExecutionResult> {
  const { mode, db, organizationId, userId, conversationId } = context

  // Import mode enforcement functions
  const { isToolAllowedInMode, getModeEnforcementError } = await import('~~/server/services/chat/tools')

  // Enforce read-only in chat mode
  if (!isToolAllowedInMode(toolInvocation.name, mode)) {
    return {
      success: false,
      error: getModeEnforcementError(toolInvocation.name)
    }
  }

  if (toolInvocation.name === 'source_ingest') {
    const args = toolInvocation.arguments as ChatToolInvocation<'source_ingest'>['arguments']
    const sourceType = validateRequiredString(args.sourceType, 'sourceType') as 'youtube' | 'context'

    if (sourceType === 'youtube') {
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
          mode: context.mode,
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
            sourceType: 'youtube',
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
    } else if (sourceType === 'context') {
      const contextText = validateRequiredString(args.context, 'context')
      const title = validateOptionalString(args.title, 'title')

      try {
        const manualSource = await createSourceContentFromContext({
          db,
          organizationId,
          userId,
          context: contextText,
          title: title ?? null,
          mode: context.mode,
          metadata: { createdVia: 'chat_source_ingest_tool' },
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
            error: 'Failed to create source content from context'
          }
        }

        return {
          success: true,
          result: {
            sourceContentId: manualSource.id,
            sourceType: 'context',
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
          error: error?.message || 'Failed to save context'
        }
      }
    } else {
      return {
        success: false,
        error: `Invalid sourceType: ${sourceType}. Must be 'youtube' or 'context'.`
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

  if (toolInvocation.name === 'content_write') {
    const args = toolInvocation.arguments as ChatToolInvocation<'content_write'>['arguments']
    const action = validateRequiredString(args.action, 'action') as 'create' | 'enrich'

    if (action === 'create') {
      try {
        let resolvedSourceContentId: string | null = args.sourceContentId ?? null
        // Handle both sourceText and context parameters (context is alias for sourceText)
        const resolvedSourceText: string | null = args.sourceText ?? args.context ?? null

        // If sourceText/context is provided but no sourceContentId, create source content first
        if (resolvedSourceText && !resolvedSourceContentId) {
          const manualSource = await createSourceContentFromContext({
            db,
            organizationId,
            userId,
            context: resolvedSourceText,
            mode: context.mode,
            metadata: { createdVia: 'chat_content_write_tool' },
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
              error: 'Failed to create source content from context'
            }
          }

          resolvedSourceContentId = manualSource.id
        }

        // Get conversation history for context generation
        const previousMessages = await getConversationMessages(db, conversationId, organizationId)
        const conversationHistory: ChatCompletionMessage[] = previousMessages.map(message => ({
          role: message.role === 'assistant'
            ? 'assistant'
            : message.role === 'system'
              ? 'system'
              : 'user',
          content: message.content
        }))

        // Allow generation with conversation history even if no source content
        if (!resolvedSourceContentId && !resolvedSourceText && (!conversationHistory || conversationHistory.length === 0)) {
          return {
            success: false,
            error: 'Either sourceContentId, sourceText/context, or conversationHistory is required for action="create"'
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
          conversationHistory: conversationHistory.length > 0 ? conversationHistory : null,
          contentId: null, // action='create' only creates new content, never updates existing ones
          event: context.event,
          mode: context.mode,
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
          error: error?.message || 'Failed to create content'
        }
      }
    } else if (action === 'enrich') {
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
          error: error?.message || 'Failed to enrich content'
        }
      }
    } else {
      return {
        success: false,
        error: `Invalid action: ${action}. Must be 'create' or 'enrich'.`
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
        temperature: sanitizedTemperature,
        mode: context.mode
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

  if (toolInvocation.name === 'read_content') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_content'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')

    try {
      const rows = await db
        .select({
          content: schema.content,
          sourceContent: schema.sourceContent,
          currentVersion: schema.contentVersion
        })
        .from(schema.content)
        .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
        .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
        .where(and(
          eq(schema.content.organizationId, organizationId),
          eq(schema.content.id, contentId)
        ))
        .limit(1)

      const record = rows[0]

      if (!record || !record.content) {
        return {
          success: false,
          error: 'Content not found'
        }
      }

      return {
        success: true,
        result: {
          content: {
            id: record.content.id,
            title: record.content.title,
            status: record.content.status,
            contentType: record.content.contentType,
            slug: record.content.slug,
            primaryKeyword: record.content.primaryKeyword,
            targetLocale: record.content.targetLocale,
            createdAt: record.content.createdAt,
            updatedAt: record.content.updatedAt
          },
          version: record.currentVersion
            ? {
                id: record.currentVersion.id,
                version: record.currentVersion.version,
                frontmatter: record.currentVersion.frontmatter,
                sections: record.currentVersion.sections,
                createdAt: record.currentVersion.createdAt
              }
            : null,
          sourceContent: record.sourceContent
            ? {
                id: record.sourceContent.id,
                title: record.sourceContent.title,
                sourceType: record.sourceContent.sourceType,
                ingestStatus: record.sourceContent.ingestStatus
              }
            : null
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read content'
      }
    }
  }

  if (toolInvocation.name === 'read_section') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_section'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')
    const sectionId = validateRequiredString(args.sectionId, 'sectionId')

    try {
      const rows = await db
        .select({
          content: schema.content,
          currentVersion: schema.contentVersion
        })
        .from(schema.content)
        .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
        .where(and(
          eq(schema.content.organizationId, organizationId),
          eq(schema.content.id, contentId)
        ))
        .limit(1)

      const record = rows[0]

      if (!record || !record.content) {
        return {
          success: false,
          error: 'Content not found'
        }
      }

      if (!record.currentVersion) {
        return {
          success: false,
          error: 'Content has no version'
        }
      }

      const sections = record.currentVersion.sections as Array<{
        id?: string
        title?: string
        body?: string
        [key: string]: any
      }> | null

      if (!sections || !Array.isArray(sections)) {
        return {
          success: false,
          error: 'Content has no sections'
        }
      }

      const section = sections.find(s => s.id === sectionId || (s as any).section_id === sectionId)

      if (!section) {
        return {
          success: false,
          error: `Section with id "${sectionId}" not found`
        }
      }

      return {
        success: true,
        result: {
          contentId: record.content.id,
          sectionId: section.id,
          section: {
            ...section,
            id: section.id,
            title: section.title,
            body: section.body
          }
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read section'
      }
    }
  }

  if (toolInvocation.name === 'read_source') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_source'>['arguments']
    const sourceContentId = validateUUID(args.sourceContentId, 'sourceContentId')

    try {
      const [sourceContent] = await db
        .select()
        .from(schema.sourceContent)
        .where(and(
          eq(schema.sourceContent.organizationId, organizationId),
          eq(schema.sourceContent.id, sourceContentId)
        ))
        .limit(1)

      if (!sourceContent) {
        return {
          success: false,
          error: 'Source content not found'
        }
      }

      return {
        success: true,
        result: {
          sourceContent: {
            id: sourceContent.id,
            title: sourceContent.title,
            sourceType: sourceContent.sourceType,
            ingestStatus: sourceContent.ingestStatus,
            sourceText: sourceContent.sourceText,
            metadata: sourceContent.metadata,
            createdAt: sourceContent.createdAt,
            updatedAt: sourceContent.updatedAt
          }
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read source content'
      }
    }
  }

  if (toolInvocation.name === 'read_content_list') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_content_list'>['arguments']

    try {
      const DEFAULT_LIMIT = 20
      const MAX_LIMIT = 100

      // Parse and validate limit
      let limit = args.limit !== undefined && args.limit !== null
        ? validateNumber(args.limit, 'limit', 1, MAX_LIMIT)
        : DEFAULT_LIMIT
      limit = Math.min(limit, MAX_LIMIT)

      // Parse and validate offset
      const offset = args.offset !== undefined && args.offset !== null
        ? validateNumber(args.offset, 'offset', 0)
        : 0

      // Build where clauses
      const whereClauses = [eq(schema.content.organizationId, organizationId)]

      if (args.status !== undefined && args.status !== null) {
        const status = validateRequiredString(args.status, 'status')
        whereClauses.push(eq(schema.content.status, status))
      }

      if (args.contentType !== undefined && args.contentType !== null) {
        const contentType = validateRequiredString(args.contentType, 'contentType')
        whereClauses.push(eq(schema.content.contentType, contentType))
      }

      const whereClause = whereClauses.length > 1 ? and(...whereClauses) : whereClauses[0]

      // Determine order by
      const orderByField = args.orderBy || 'updatedAt'
      const orderDirection = args.orderDirection || 'desc'

      let orderByClause
      if (orderByField === 'title') {
        orderByClause = orderDirection === 'asc' ? asc(schema.content.title) : desc(schema.content.title)
      } else if (orderByField === 'createdAt') {
        orderByClause = orderDirection === 'asc' ? asc(schema.content.createdAt) : desc(schema.content.createdAt)
      } else {
        // Default to updatedAt
        orderByClause = orderDirection === 'asc' ? asc(schema.content.updatedAt) : desc(schema.content.updatedAt)
      }

      // Get total count
      const totalResult = await db
        .select({ value: count() })
        .from(schema.content)
        .where(whereClause)

      const total = Number(totalResult[0]?.value ?? 0)

      // Get items
      const rows = await db
        .select({
          content: schema.content,
          currentVersion: schema.contentVersion
        })
        .from(schema.content)
        .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset)

      const items = rows.map(row => ({
        id: row.content.id,
        title: row.content.title,
        status: row.content.status,
        contentType: row.content.contentType,
        slug: row.content.slug,
        primaryKeyword: row.content.primaryKeyword,
        targetLocale: row.content.targetLocale,
        createdAt: row.content.createdAt.toISOString(),
        updatedAt: row.content.updatedAt.toISOString(),
        hasVersion: row.currentVersion !== null,
        sourceContentId: row.content.sourceContentId
      }))

      return {
        success: true,
        result: {
          items,
          total,
          limit,
          offset
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to list content'
      }
    }
  }

  if (toolInvocation.name === 'read_source_list') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_source_list'>['arguments']

    try {
      const DEFAULT_LIMIT = 20
      const MAX_LIMIT = 100

      // Parse and validate limit
      let limit = args.limit !== undefined && args.limit !== null
        ? validateNumber(args.limit, 'limit', 1, MAX_LIMIT)
        : DEFAULT_LIMIT
      limit = Math.min(limit, MAX_LIMIT)

      // Parse and validate offset
      const offset = args.offset !== undefined && args.offset !== null
        ? validateNumber(args.offset, 'offset', 0)
        : 0

      // Build where clauses
      const whereClauses = [eq(schema.sourceContent.organizationId, organizationId)]

      if (args.sourceType !== undefined && args.sourceType !== null) {
        const sourceType = validateRequiredString(args.sourceType, 'sourceType')
        whereClauses.push(eq(schema.sourceContent.sourceType, sourceType))
      }

      if (args.ingestStatus !== undefined && args.ingestStatus !== null) {
        const ingestStatus = validateRequiredString(args.ingestStatus, 'ingestStatus')
        // Validate against enum if available
        type IngestStatus = (typeof schema.ingestStatusEnum)['enumValues'][number]
        if (schema.ingestStatusEnum.enumValues.includes(ingestStatus as any)) {
          whereClauses.push(eq(schema.sourceContent.ingestStatus, ingestStatus as IngestStatus))
        }
      }

      const whereClause = whereClauses.length > 1 ? and(...whereClauses) : whereClauses[0]

      // Determine order by
      const orderByField = args.orderBy || 'updatedAt'
      const orderDirection = args.orderDirection || 'desc'

      let orderByClause
      if (orderByField === 'title') {
        orderByClause = orderDirection === 'asc' ? asc(schema.sourceContent.title) : desc(schema.sourceContent.title)
      } else if (orderByField === 'createdAt') {
        orderByClause = orderDirection === 'asc' ? asc(schema.sourceContent.createdAt) : desc(schema.sourceContent.createdAt)
      } else {
        // Default to updatedAt
        orderByClause = orderDirection === 'asc' ? asc(schema.sourceContent.updatedAt) : desc(schema.sourceContent.updatedAt)
      }

      // Get total count
      const totalResult = await db
        .select({ value: count() })
        .from(schema.sourceContent)
        .where(whereClause)

      const total = Number(totalResult[0]?.value ?? 0)

      // Get items
      const rows = await db
        .select()
        .from(schema.sourceContent)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset)

      const items = rows.map(row => ({
        id: row.id,
        title: row.title,
        sourceType: row.sourceType,
        ingestStatus: row.ingestStatus,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        hasContext: row.sourceText !== null && row.sourceText.length > 0
      }))

      return {
        success: true,
        result: {
          items,
          total,
          limit,
          offset
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to list source content'
      }
    }
  }

  if (toolInvocation.name === 'read_workspace_summary') {
    const args = toolInvocation.arguments as ChatToolInvocation<'read_workspace_summary'>['arguments']
    const contentId = validateUUID(args.contentId, 'contentId')

    try {
      const rows = await db
        .select({
          content: schema.content,
          sourceContent: schema.sourceContent,
          currentVersion: schema.contentVersion
        })
        .from(schema.content)
        .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
        .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
        .where(and(
          eq(schema.content.organizationId, organizationId),
          eq(schema.content.id, contentId)
        ))
        .limit(1)

      const record = rows[0]

      if (!record || !record.content) {
        return {
          success: false,
          error: 'Content not found'
        }
      }

      // Build workspace summary using existing helper
      const summary = buildWorkspaceSummary({
        content: record.content,
        currentVersion: record.currentVersion ?? undefined,
        sourceContent: record.sourceContent ?? undefined
      })

      // Extract section count
      const sections = record.currentVersion?.sections
      const sectionCount = Array.isArray(sections) ? sections.length : 0

      return {
        success: true,
        result: {
          contentId: record.content.id,
          summary: summary || 'No summary available for this workspace.',
          content: {
            id: record.content.id,
            title: record.content.title,
            status: record.content.status,
            contentType: record.content.contentType
          },
          version: record.currentVersion
            ? {
                id: record.currentVersion.id,
                version: record.currentVersion.version,
                sectionCount
              }
            : null,
          sourceContent: record.sourceContent
            ? {
                id: record.sourceContent.id,
                title: record.sourceContent.title,
                sourceType: record.sourceContent.sourceType
              }
            : null
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read workspace summary'
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
 * **Terminology Note:**
 * This endpoint uses "conversation" (not "session") to refer to chat conversations.
 * "Session" is reserved for Better Auth authentication sessions to maintain clear
 * separation of concerns. This avoids confusion between auth state and chat state.
 *
 * **Key Features:**
 * - Natural language input - no need to construct action payloads
 * - Multi-pass orchestration - agent can chain multiple tool calls
 * - Automatic tool selection - agent chooses the right tool based on context
 * - Mode-based access control - chat mode (read-only) vs agent mode (read+write)
 * - Structured logging - tool_started, tool_succeeded, tool_failed logs for observability
 * - Error handling - automatic retries with configurable limits
 *
 * **Modes:**
 * - `chat` (read-only): Can use read tools (`read_content`, `read_section`, `read_source`, `read_content_list`, `read_source_list`, `read_workspace_summary`) to inspect content
 *   but cannot modify content or ingest new data. Write/ingest tools are filtered out at both the tool selection and execution layers.
 * - `agent` (read+write): Full toolset available including write and ingest operations.
 *
 * **Available Tools:**
 * - Read tools (available in both modes): `read_content`, `read_section`, `read_source`, `read_content_list`, `read_source_list`, `read_workspace_summary`
 * - Write tools (agent mode only): `content_write` (with action="create" or action="enrich"), `edit_section`, `edit_metadata`
 * - Ingest tools (agent mode only): `source_ingest` (with sourceType="youtube" or sourceType="context")
 *
 * @contract
 * **Input:**
 * ```typescript
 * {
 *   message: string (required) - Natural language user message
 *   conversationId?: string - Existing conversation ID to continue conversation
 *   mode: 'chat' | 'agent' - Mode selector (required)
 * }
 * ```
 *
 * **Output (SSE Stream):**
 * This endpoint returns a Server-Sent Events (SSE) stream with the following events:
 *
 * - `conversation:update` - Conversation state changes (conversationId)
 * - `message:chunk` - Incremental LLM text chunks (`{ messageId: string, chunk: string }`)
 * - `message:complete` - LLM text generation finished (`{ messageId: string, message: string }`)
 * - `tool:start` - Tool execution started (`{ toolName: string, timestamp: string }`)
 * - `tool:complete` - Tool execution completed (`{ toolName, success, result, error, timestamp }`)
 * - `log:entry` - Log entries (`{ id, type, message, payload, createdAt }`)
 * - `messages:complete` - **Authoritative message list from database** (`{ messages: Array }`)
 * - `logs:complete` - Authoritative log list from database (`{ logs: Array }`)
 * - `agentContext:update` - Final agent context (`{ readySources, ingestFailures, lastAction, toolHistory }`)
 * - `conversation:final` - Final conversation state (`{ conversationId }`)
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
 * // 1. Call source_ingest tool with sourceType="youtube" to fetch captions
 * // 2. Call content_write tool with action="create" to create the content
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

  if (!organizationId) {
    try {
      const orgResult = await requireActiveOrganization(event, user.id, { isAnonymousUser: user.isAnonymous ?? false })
      organizationId = orgResult.organizationId
    } catch (error: any) {
      if (user.isAnonymous) {
        throw createValidationError('Please create an account to use the chat feature. Anonymous users need an organization to continue.')
      }
      throw error
    }
  }

  if (!organizationId) {
    throw createValidationError('No active organization found. Please create an account or select an organization.')
  }

  const body = await readBody<ChatRequestBody>(event)

  validateRequestBody(body)

  const VALID_MODES = ['chat', 'agent'] as const
  const mode = validateEnum(body.mode, VALID_MODES, 'mode')

  // Block agent mode for anonymous users
  if (mode === 'agent' && user.isAnonymous) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Agent mode requires authentication',
      message: 'Please sign in to use agent mode and save content.'
    })
  }

  const message = typeof body.message === 'string' ? body.message : ''
  const trimmedMessage = message.trim()
  const requestConversationId = body.conversationId
    ? validateOptionalUUID(body.conversationId, 'conversationId')
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

  const _initialSessionContentId = requestContentId

  // Declare multiPassResult variable for use later
  let multiPassResult: Awaited<ReturnType<typeof runChatAgentWithMultiPassStream>> | null = null

  let conversation: typeof schema.conversation.$inferSelect | null = null
  if (requestConversationId) {
    conversation = await getConversationById(db, requestConversationId, organizationId)
    if (!conversation) {
      console.warn(`Conversation ${requestConversationId} not found for organization ${organizationId}, creating new conversation`)
    }
  }

  if (!conversation) {
    // Check conversation quota before creating a new conversation
    await ensureConversationCapacity(db, organizationId, user, event)

    const lastAction = trimmedMessage ? 'message' : null
    conversation = await createConversation(db, {
      organizationId,
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

  if (!conversation) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create chat conversation'
    })
  }

  // From this point on, conversation is guaranteed to be non-null
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
    const linkedContentId = (activeConversation.metadata as Record<string, any>)?.linkedContentId
    if (linkedContentId) {
      try {
        const [contentRecord] = await db
          .select()
          .from(schema.content)
          .where(and(
            eq(schema.content.id, linkedContentId),
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
            contextBlocks.push(`Current content ID: ${linkedContentId}`)
          }
        } else {
          console.warn(`Content ${linkedContentId} not found`)
        }
      } catch (error) {
        console.error('Failed to build workspace summary for context', error)
        contextBlocks.push(`Current content ID: ${linkedContentId}`)
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

    // Add recent tool outcomes from conversation logs
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

    if (trimmedMessage) {
      // Check if this is the first message before adding it (for title generation)
      const existingTitle = activeConversation.metadata?.title
      const messagesBeforeAdd = await getConversationMessages(db, activeConversation.id, organizationId)
      const isFirstMessage = messagesBeforeAdd.length === 0 && !existingTitle

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

      // Generate conversation title if this is the first message
      if (isFirstMessage) {
        // Generate title asynchronously (don't block the response)
        const conversationId = activeConversation.id
        generateConversationTitle(trimmedMessage)
          .then(async (title) => {
            try {
              // Re-fetch the latest conversation to avoid stale metadata
              const latestConversation = await getConversationById(db, conversationId, organizationId)
              if (!latestConversation) {
                console.error('[chat] Conversation not found when updating title')
                return
              }
              await db
                .update(schema.conversation)
                .set({
                  metadata: {
                    ...(latestConversation.metadata as Record<string, any> || {}),
                    title
                  },
                  updatedAt: new Date()
                })
                .where(eq(schema.conversation.id, conversationId))
            } catch (error) {
              console.error('[chat] Failed to save conversation title:', error)
            }
          })
          .catch((error) => {
            console.error('[chat] Failed to generate conversation title:', error)
          })
      }
    }

    try {
      // Streaming multi-pass orchestration - handles all tools directly
      // Track assistant message for potential future use (used in callbacks)
      let _currentAssistantMessage = ''

      // Log request context before calling agent
      console.log('[Chat API] Calling agent with context:', {
        mode,
        conversationId: activeConversation.id,
        organizationId,
        userId: user.id,
        userMessageLength: trimmedMessage.length,
        conversationHistoryLength: conversationHistory.length,
        contextBlocksCount: contextBlocks.length,
        readySourcesCount: readySources.length,
        ingestionErrorsCount: ingestionErrors.length
      })

      // Send initial conversation update
      // Event: conversation:update - Emitted when conversation state changes
      // Client should update conversationId state
      writeSSE('conversation:update', {
        conversationId: activeConversation.id
      })

      multiPassResult = await runChatAgentWithMultiPassStream({
        mode,
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
        onToolStart: async (toolCallId: string, toolName: string) => {
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
          // Emit SSE with toolCallId for client tracking
          writeSSE('tool:start', {
            toolCallId,
            toolName,
            timestamp: new Date().toISOString()
          })
        },
        onToolComplete: async (toolCallId: string, toolName: string, result: any) => {
          // Event: tool:complete - Tool execution finished for current turn
          // Client should update UI to reflect tool completion status
          writeSSE('tool:complete', {
            toolCallId,
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
            mode,
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
                  conversationId: activeConversation.id
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
          // Update conversation with new content if content_write or edit_section succeeded
          if (toolExec.result.success && toolExec.result.contentId) {
            const newContentId = toolExec.result.contentId
            const currentLinkedId = (activeConversation.metadata as Record<string, any>)?.linkedContentId
            if (currentLinkedId !== newContentId) {
              const [updatedConversation] = await db
                .update(schema.conversation)
                .set({
                  // contentId removed from schema, stored in metadata only
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
                  conversationId: activeConversation.id
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
    } catch (error: any) {
      const isDev = process.env.NODE_ENV === 'development'

      // Extract detailed error information
      const errorMessage = error?.message || error?.data?.message || error?.statusMessage || 'Unknown error'
      const errorStatus = error?.statusCode || error?.status || 'N/A'
      const errorData = error?.data || {}

      // Log comprehensive error details with full request context
      const chatApiErrorContext = {
        mode,
        conversationId: activeConversation.id,
        organizationId,
        userId: user.id,
        userMessageLength: trimmedMessage.length,
        userMessagePreview: isDev ? trimmedMessage.slice(0, 100) + (trimmedMessage.length > 100 ? '...' : '') : undefined,
        conversationHistoryLength: conversationHistory.length,
        contextBlocksCount: contextBlocks.length,
        readySourcesCount: readySources.length,
        ingestionErrorsCount: ingestionErrors.length,
        message: errorMessage,
        status: errorStatus,
        stack: isDev && error instanceof Error ? error.stack : undefined
      }

      console.error('[Chat API] Agent turn failed with full context:', chatApiErrorContext)

      // Include actual error details in dev mode, generic message in prod
      // Add helpful context about what failed
      let userErrorMessage = isDev
        ? `I encountered an error while processing your request: ${errorMessage}`
        : 'I encountered an error while processing your request. Please try again.'

      // Add mode-specific context to error message
      if (isDev && mode === 'agent') {
        userErrorMessage += `\n\n[Debug Info] Mode: ${mode}, Error Status: ${errorStatus}`
        if (errorData?.details) {
          userErrorMessage += `\n[Debug Info] Gateway Response: ${JSON.stringify(errorData.details, null, 2)}`
        }
      }

      ingestionErrors.push({
        content: userErrorMessage,
        payload: {
          error: errorMessage,
          status: errorStatus,
          type: 'agent_failure',
          ...(isDev && error instanceof Error && error.stack
            ? { stack: error.stack }
            : {}),
          ...(isDev && error instanceof Error
            ? {
                errorName: error.name,
                errorCause: error.cause ? String(error.cause) : undefined
              }
            : {})
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
    // Find content_write or edit_section results
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

  // User message is now saved before agent execution to ensure persistence

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

  // Get last action from conversation metadata
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

  // Event: conversation:final - Final conversation state after all processing
  // Client should update conversationId with final value
  writeSSE('conversation:final', {
    conversationId: activeConversation.id
  })

  // Event: done - Stream completion signal
  // Client should treat stream as complete. If messages:complete was not received, treat as error.
  writeSSE('done', {})
  event.node.res.end()

  // Return null (response already sent via SSE stream)
  return null
})
