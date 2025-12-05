import type { ChatActionSuggestion } from '#shared/utils/types'
import type { YouTubeTranscriptErrorData } from '~~/server/services/sourceContent/youtubeIngest'
import type { ChatRequestBody } from '~~/server/types/api'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import {
  addLogEntryToChatSession,
  addMessageToChatSession,
  getOrCreateChatSessionForContent,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { generateContentDraftFromSource, updateContentSectionWithAI } from '~~/server/services/content/generation'
import { buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { ensureAccessToken, fetchYouTubeVideoMetadata, findYouTubeAccount, ingestYouTubeVideoAsSourceContent } from '~~/server/services/sourceContent/youtubeIngest'
import { requireAuth } from '~~/server/utils/auth'
import { classifyUrl, extractUrls } from '~~/server/utils/chat'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createServiceUnavailableError, createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateEnum, validateNumber, validateOptionalUUID, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'

function buildYouTubeTranscriptErrorMessage(errorData: YouTubeTranscriptErrorData | undefined, hasYouTubeAccount: boolean) {
  const reason = (errorData?.userMessage || 'Unable to fetch transcript.').trim()
  const suggestions: string[] = []

  if (!hasYouTubeAccount || errorData?.suggestAccountLink) {
    const hint = (typeof errorData?.accountLinkHint === 'string' && errorData.accountLinkHint.trim())
      ? errorData.accountLinkHint.trim()
      : 'Link your YouTube account from Settings -> Integrations to unlock more accurate captions using the official API.'
    suggestions.push(`💡 Tip: ${hint}`)
  }

  if (errorData?.canRetry !== false) {
    suggestions.push('Please try again or check if the video has captions enabled.')
  }

  const suggestionText = suggestions.length ? ` ${suggestions.join(' ')}` : ''

  return `❌ Error: I can't get the transcript for this video. ${reason}${suggestionText}`
}

interface WorkspaceFilePayload {
  id: string
  filename: string
  body: string
  frontmatter: Record<string, any> | null
  wordCount: number
  sectionsCount: number
  seoSnapshot: Record<string, any> | null
  seoPlan: Record<string, any> | null
  frontmatterKeywords: string[]
  seoKeywords: string[]
  tags: string[]
  schemaTypes: string[]
  generatorDetails: Record<string, any> | null
  generatorStages: string[]
  sourceDetails: typeof schema.sourceContent.$inferSelect | null
  sourceLink: string | null
  fullMdx: string
}

const FRONTMATTER_KEY_ORDER = [
  'title',
  'seoTitle',
  'description',
  'slug',
  'contentType',
  'targetLocale',
  'status',
  'primaryKeyword',
  'keywords',
  'tags',
  'schemaTypes',
  'sourceContentId'
]

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter((item): item is string => Boolean(item))
}

function formatScalar(value: any): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return JSON.stringify(value)
}

function toYamlLines(value: any, indent = 0): string[] {
  const prefix = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) {
      return [`${prefix}[]`]
    }
    return value.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}-`, ...toYamlLines(entry, indent + 1)]
      }
      return [`${prefix}- ${formatScalar(entry)}`]
    })
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, any>)
    if (!entries.length) {
      return [`${prefix}{}`]
    }
    return entries.flatMap(([key, entry]) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}${key}:`, ...toYamlLines(entry, indent + 1)]
      }
      return [`${prefix}${key}: ${formatScalar(entry)}`]
    })
  }
  return [`${prefix}${formatScalar(value)}`]
}

function orderFrontmatter(frontmatter: Record<string, any>) {
  const ordered: Record<string, any> = {}
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (frontmatter[key] !== undefined) {
      ordered[key] = frontmatter[key]
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (ordered[key] === undefined) {
      ordered[key] = value
    }
  }
  return ordered
}

function buildFrontmatterBlock(frontmatter: Record<string, any> | null | undefined) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return '---\n---'
  }
  const filtered = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0
      }
      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0
      }
      return value !== null && value !== undefined && value !== ''
    })
  )
  const ordered = orderFrontmatter(filtered)
  const lines = toYamlLines(ordered)
  return ['---', ...lines, '---'].join('\n')
}

function resolveFilePath(content: typeof schema.content.$inferSelect, version: typeof schema.contentVersion.$inferSelect) {
  const frontmatterSlug = typeof version.frontmatter?.slug === 'string' ? version.frontmatter.slug : ''
  const contentSlug = typeof content.slug === 'string' ? content.slug : ''
  const slug = frontmatterSlug || contentSlug || 'draft'
  const cleaned = slug
    .replace(/^content\//, '')
    .replace(/^\/+/, '')
    .replace(/\.mdx$/i, '')
  return `content/${cleaned}.mdx`
}

function resolveSourceLink(
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  assets: typeof schema.contentVersion.$inferSelect['assets']
) {
  const metadata = sourceContent?.metadata as Record<string, any> | undefined
  if (metadata?.originalUrl) {
    return metadata.originalUrl
  }
  if (sourceContent?.sourceType === 'youtube' && sourceContent.externalId) {
    return `https://www.youtube.com/watch?v=${sourceContent.externalId}`
  }
  const assetSource = assets && typeof assets === 'object' ? (assets as any).source : null
  if (assetSource?.originalUrl) {
    return assetSource.originalUrl
  }
  return null
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

function buildWorkspaceFilesPayload(
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect,
  sourceContent: typeof schema.sourceContent.$inferSelect | null
): WorkspaceFilePayload[] {
  const body = version.bodyMdx || version.bodyHtml || ''
  const sections = Array.isArray(version.sections) ? version.sections : []
  const frontmatter = version.frontmatter && typeof version.frontmatter === 'object'
    ? version.frontmatter as Record<string, any>
    : {}
  const seoSnapshot = version.seoSnapshot && typeof version.seoSnapshot === 'object'
    ? version.seoSnapshot as Record<string, any>
    : null
  const seoPlan = seoSnapshot && typeof seoSnapshot.plan === 'object' ? seoSnapshot.plan : null
  const generatorDetails = version.assets && typeof version.assets === 'object' ? (version.assets as any).generator ?? null : null
  const generatorStages = Array.isArray(generatorDetails?.stages)
    ? generatorDetails.stages.filter((stage: any) => typeof stage === 'string').map((stage: string) => stage.trim()).filter(Boolean)
    : []
  const filename = resolveFilePath(content, version)
  const frontmatterKeywords = normalizeStringArray(frontmatter.keywords || frontmatter.tags || [])
  const tags = normalizeStringArray(frontmatter.tags)
  const schemaTypes = normalizeStringArray(frontmatter.schemaTypes)
  const seoKeywords = normalizeStringArray(seoPlan?.keywords)
  const wordCount = sections.reduce((total, section: any) => {
    const count = typeof section?.wordCount === 'number' ? section.wordCount : Number(section?.wordCount) || 0
    return total + count
  }, 0) || body.split(/\s+/).filter(Boolean).length
  const frontmatterBlock = buildFrontmatterBlock(frontmatter)
  const fullMdxParts = [frontmatterBlock, body].filter(Boolean)
  const fullMdx = fullMdxParts.join('\n\n')

  return [
    {
      id: version.id || filename,
      filename,
      body,
      frontmatter,
      wordCount,
      sectionsCount: sections.length,
      seoSnapshot,
      seoPlan,
      frontmatterKeywords,
      seoKeywords,
      tags,
      schemaTypes,
      generatorDetails,
      generatorStages,
      sourceDetails: sourceContent,
      sourceLink: resolveSourceLink(sourceContent, version.assets),
      fullMdx
    }
  ]
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

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const body = await readBody<ChatRequestBody>(event)

  validateRequestBody(body)

  const message = typeof body.message === 'string' ? body.message : ''

  if (!message.trim() && !body.action) {
    throw createValidationError('Message or action is required')
  }

  const urls = extractUrls(message)
  const seenKeys = new Set<string>()
  const processedSources: Array<{
    source: Awaited<ReturnType<typeof upsertSourceContent>>
    url: string
    sourceType: string
  }> = []
  const ingestionErrors: Array<{ content: string, payload?: Record<string, any> | null }> = []
  const actionSuggestions: ChatActionSuggestion[] = []
  const suggestedSourceIds = new Set<string>()

  const addDraftSuggestionForSource = (source: typeof schema.sourceContent.$inferSelect | null | undefined, label?: string) => {
    if (!source || !source.id || source.ingestStatus !== 'ingested' || suggestedSourceIds.has(source.id)) {
      return
    }
    actionSuggestions.push({
      type: 'suggest_generate_from_source',
      sourceContentId: source.id,
      sourceType: source.sourceType ?? undefined,
      label: label || (source.sourceType === 'youtube' ? 'Draft from this YouTube video' : 'Draft from this transcript')
    })
    suggestedSourceIds.add(source.id)
  }

  for (const rawUrl of urls) {
    const classification = classifyUrl(rawUrl)
    if (!classification) {
      continue
    }

    const key = `${classification.sourceType}:${classification.externalId ?? classification.url}`
    if (seenKeys.has(key)) {
      continue
    }

    let record = await upsertSourceContent(db, {
      organizationId,
      userId: user.id,
      sourceType: classification.sourceType,
      externalId: classification.externalId,
      metadata: classification.metadata ?? { originalUrl: rawUrl },
      title: null,
      sourceText: null
    })

    if (!record) {
      continue
    }

    if (classification.sourceType === 'youtube' && classification.externalId && runtimeConfig.enableYoutubeIngestion) {
      try {
        record = await ingestYouTubeVideoAsSourceContent({
          event,
          db,
          sourceContentId: record.id,
          organizationId,
          userId: user.id,
          videoId: classification.externalId
        })
        addDraftSuggestionForSource(record)
      } catch (error: any) {
        const errorData = error?.data as YouTubeTranscriptErrorData | undefined
        if (errorData?.transcriptFailed) {
          const hasYouTubeAccount = !!(await findYouTubeAccount(db, organizationId, user.id))
          ingestionErrors.push({
            content: buildYouTubeTranscriptErrorMessage(errorData, hasYouTubeAccount),
            payload: {
              transcriptFailed: true,
              videoId: classification.externalId,
              reasonCode: errorData?.reasonCode ?? null
            }
          })
          continue
        }
        throw error
      }
    } else if (classification.sourceType === 'youtube' && !runtimeConfig.enableYoutubeIngestion) {
      throw createServiceUnavailableError('YouTube ingestion is disabled. Enable it in configuration to process YouTube links.')
    }

    processedSources.push({
      source: record,
      url: rawUrl,
      sourceType: classification.sourceType
    })

    seenKeys.add(key)
  }

  // Detect transcripts in message
  const transcriptPrefix = 'Transcript attachment:'
  if (message.trim().startsWith(transcriptPrefix)) {
    const transcriptText = message.trim().slice(transcriptPrefix.length).trim()
    if (transcriptText.length > 200) {
      // Create transcript source
      const manualSource = await createSourceContentFromTranscript({
        db,
        organizationId,
        userId: user.id,
        transcript: transcriptText,
        metadata: { createdVia: 'chat_message_auto_detect' },
        onProgress: async () => {
          // Progress messages will be handled by the assistant message
        }
      })

      if (manualSource) {
        processedSources.push({
          source: manualSource,
          url: '',
          sourceType: 'manual_transcript'
        })
        addDraftSuggestionForSource(manualSource)
      }
    }
  } else if (message.trim().length > 500 && !urls.length) {
    // Auto-detect potential transcripts: long messages without URLs
    // Check for transcript-like patterns (speaker labels, timestamps, etc.)
    const hasTranscriptPatterns = /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:|\[?\d{1,2}:\d{2}(?::\d{2})?\]?)/m.test(message.trim())
    if (hasTranscriptPatterns) {
      const manualSource = await createSourceContentFromTranscript({
        db,
        organizationId,
        userId: user.id,
        transcript: message.trim(),
        metadata: { createdVia: 'chat_message_auto_detect' },
        onProgress: async () => {
          // Progress messages will be handled by the assistant message
        }
      })

      if (manualSource) {
        processedSources.push({
          source: manualSource,
          url: '',
          sourceType: 'manual_transcript'
        })
        addDraftSuggestionForSource(manualSource)
      }
    }
  }

  let resolvedSourceContentId = (body.action?.type === 'generate_content' && body.action.sourceContentId)
    ? validateOptionalUUID(body.action.sourceContentId, 'action.sourceContentId')
    : processedSources[0]?.source?.id ?? null

  const requestContentId = (body as any).contentId
    ? validateOptionalUUID((body as any).contentId, 'contentId')
    : null

  const initialSessionContentId = (body.action?.type === 'generate_content' && body.action.contentId)
    ? validateOptionalUUID(body.action.contentId, 'action.contentId')
    : requestContentId

  const sessionSourceId = resolvedSourceContentId ?? null

  // Ensure session exists early so we can send progress messages
  let session = await getOrCreateChatSessionForContent(db, {
    organizationId,
    contentId: initialSessionContentId,
    sourceContentId: sessionSourceId,
    createdByUserId: user.id,
    metadata: {
      lastAction: body.action?.type ?? (message.trim() ? 'message' : null)
    }
  })

  if (!session) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create chat session'
    })
  }

  if (sessionSourceId && !suggestedSourceIds.has(sessionSourceId)) {
    const existingSource = processedSources.find(item => item.source.id === sessionSourceId)?.source
    if (existingSource) {
      addDraftSuggestionForSource(existingSource)
    } else {
      const [sessionSource] = await db
        .select()
        .from(schema.sourceContent)
        .where(and(
          eq(schema.sourceContent.id, sessionSourceId),
          eq(schema.sourceContent.organizationId, organizationId)
        ))
        .limit(1)
      if (sessionSource) {
        addDraftSuggestionForSource(sessionSource)
      }
    }
  }

  for (const errorMessage of ingestionErrors) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: errorMessage.content,
      payload: errorMessage.payload ?? null
    })
  }

  let generationResult: Awaited<ReturnType<typeof generateContentDraftFromSource>> | null = null
  let patchSectionResult: Awaited<ReturnType<typeof updateContentSectionWithAI>> | null = null
  let completionMessages: Awaited<ReturnType<typeof composeWorkspaceCompletionMessages>> | null = null

  if (body.action?.type === 'generate_content') {
    if (!resolvedSourceContentId) {
      const transcript = validateRequiredString(body.action.transcript, 'transcript')

      const manualSource = await createSourceContentFromTranscript({
        db,
        organizationId,
        userId: user.id,
        transcript,
        metadata: { createdVia: 'chat_generate_action' },
        onProgress: async (progressMessage) => {
          if (session) {
            await addMessageToChatSession(db, {
              sessionId: session.id,
              organizationId,
              role: 'assistant',
              content: progressMessage
            })
          }
        }
      })

      if (!manualSource) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to create source content from transcript'
        })
      }

      resolvedSourceContentId = manualSource.id

      // Update session with the new source
      const [updatedSession] = await db
        .update(schema.contentChatSession)
        .set({ sourceContentId: resolvedSourceContentId })
        .where(eq(schema.contentChatSession.id, session.id))
        .returning()

      if (updatedSession) {
        session = updatedSession
      }
    }
  }

  if (body.action?.type === 'generate_content') {
    const generateAction = body.action
    let sanitizedSystemPrompt: string | undefined
    if (generateAction.systemPrompt !== undefined) {
      const trimmed = validateRequiredString(generateAction.systemPrompt, 'systemPrompt')
      sanitizedSystemPrompt = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed
    }

    let sanitizedTemperature = 1
    if (generateAction.temperature !== undefined && generateAction.temperature !== null) {
      sanitizedTemperature = validateNumber(generateAction.temperature, 'temperature', 0, 2)
    }

    const planPreviewSessionId = session.id

    generationResult = await generateContentDraftFromSource(db, {
      organizationId,
      userId: user.id,
      sourceContentId: resolvedSourceContentId,
      contentId: generateAction.contentId ?? null,
      event,
      overrides: {
        title: generateAction.title ? validateRequiredString(generateAction.title, 'title') : null,
        slug: generateAction.slug ? validateRequiredString(generateAction.slug, 'slug') : null,
        status: generateAction.status ? validateEnum(generateAction.status, CONTENT_STATUSES, 'status') : undefined,
        primaryKeyword: generateAction.primaryKeyword ? validateRequiredString(generateAction.primaryKeyword, 'primaryKeyword') : null,
        targetLocale: generateAction.targetLocale ? validateRequiredString(generateAction.targetLocale, 'targetLocale') : null,
        contentType: generateAction.contentType ? validateEnum(generateAction.contentType, CONTENT_TYPES, 'contentType') : undefined
      },
      systemPrompt: sanitizedSystemPrompt,
      temperature: sanitizedTemperature,
      onPlanReady: async ({ plan, frontmatter }) => {
        const outlinePreview = plan.outline
          .map((section, index) => {
            const typeSuffix = section.type && section.type !== 'body' ? ` (${section.type})` : ''
            return `${index + 1}. ${section.title || `Section ${index + 1}`}${typeSuffix}`
          })
          .join('\n')
        const schemaSummary = frontmatter.schemaTypes.join(', ')
        const contentTypeLabel = generateAction.contentType || 'content'
        const summaryLines = [
          `Plan preview before drafting the full ${contentTypeLabel}:`,
          `Title: ${frontmatter.title ?? 'Untitled draft'}`,
          schemaSummary ? `Schema types: ${schemaSummary}` : 'Schema types: n/a',
          frontmatter.slugSuggestion ? `Slug suggestion: ${frontmatter.slugSuggestion}` : 'Slug suggestion: n/a',
          outlinePreview ? `Outline:\n${outlinePreview}` : 'Outline: (not provided)',
          'Tell me if you want any tweaks to this outline—or hit “Start draft in workspace” when you’re ready for the full article.'
        ]
        await addMessageToChatSession(db, {
          sessionId: planPreviewSessionId,
          organizationId,
          role: 'assistant',
          content: summaryLines.join('\n\n'),
          payload: {
            type: 'plan_preview',
            plan,
            frontmatter
          }
        })
      }
    })

    if (generationResult) {
      completionMessages = await composeWorkspaceCompletionMessages(
        db,
        organizationId,
        generationResult.content,
        generationResult.version
      )
    }
  }

  if (body.action?.type === 'patch_section') {
    const instructionsInput = body.action.instructions || message
    const instructions = validateRequiredString(instructionsInput, 'instructions')

    const contentIdToPatch = validateUUID(body.action.contentId, 'action.contentId')
    const sectionIdToPatch = validateRequiredString(body.action.sectionId, 'sectionId')

    const temperature = body.action.temperature !== undefined
      ? validateNumber(body.action.temperature, 'temperature', 0, 2)
      : undefined

    patchSectionResult = await updateContentSectionWithAI(db, {
      organizationId,
      userId: user.id,
      contentId: contentIdToPatch,
      sectionId: sectionIdToPatch,
      instructions,
      temperature
    })

    if (patchSectionResult) {
      completionMessages = await composeWorkspaceCompletionMessages(
        db,
        organizationId,
        patchSectionResult.content,
        patchSectionResult.version
      )
    }

    await addLogEntryToChatSession(db, {
      sessionId: session.id,
      organizationId,
      type: 'section_patched',
      message: `Updated section "${body.action.sectionTitle || patchSectionResult.section?.title || 'selected section'}"`,
      payload: {
        contentId: contentIdToPatch,
        sectionId: sectionIdToPatch
      }
    })
  }

  if (generationResult && session.contentId !== generationResult.content.id) {
    const [updatedSession] = await db
      .update(schema.contentChatSession)
      .set({
        contentId: generationResult.content.id,
        metadata: {
          ...(session.metadata ?? {}),
          linkedContentId: generationResult.content.id,
          linkedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where(eq(schema.contentChatSession.id, session.id))
      .returning()

    if (updatedSession) {
      session = updatedSession
    }
  }

  if (message.trim()) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'user',
      content: message.trim()
    })
    await addLogEntryToChatSession(db, {
      sessionId: session.id,
      organizationId,
      type: 'user_message',
      message: 'User sent a chat prompt'
    })
  }

  if (processedSources.length > 0) {
    const sourcePayload = processedSources
      .filter((item): item is typeof item & { source: NonNullable<typeof item.source> } => Boolean(item.source))
      .map(item => ({
        id: item.source.id,
        sourceType: item.sourceType,
        url: item.url
      }))

    if (sourcePayload.length) {
      await addLogEntryToChatSession(db, {
        sessionId: session.id,
        organizationId,
        type: 'source_detected',
        message: `Detected ${sourcePayload.length} source link${sourcePayload.length > 1 ? 's' : ''}`,
        payload: {
          sources: sourcePayload
        }
      })
    }
  }

  if (generationResult) {
    await addLogEntryToChatSession(db, {
      sessionId: session.id,
      organizationId,
      type: 'generation_complete',
      message: 'Draft generation completed',
      payload: {
        contentId: generationResult.content.id,
        versionId: generationResult.version.id
      }
    })
  }

  const sessionMessages = await getSessionMessages(db, session.id, organizationId)
  const conversationHistory: ChatCompletionMessage[] = sessionMessages.map(message => ({
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    content: message.content
  }))

  const assistantMessages: string[] = []

  if (processedSources.length > 0) {
    // Generate descriptive messages for each source
    for (const item of processedSources) {
      if (!item.source) {
        continue
      }
      if (item.sourceType === 'youtube' && item.source.externalId) {
        // Try to fetch YouTube video metadata
        let videoTitle = 'YouTube video'
        let videoDescription = ''

        try {
          // Check if we have access to YouTube API
          const account = await findYouTubeAccount(db, organizationId, user.id)
          if (account) {
            const accessToken = await ensureAccessToken(db, account)
            const metadata = await fetchYouTubeVideoMetadata(accessToken, item.source.externalId)
            if (metadata) {
              videoTitle = metadata.title
              videoDescription = metadata.description
            }
          }
        } catch (error) {
          console.error('Failed to fetch YouTube metadata', error)
        }

        // Generate descriptive message using LLM
        const { callChatCompletions } = await import('~~/server/utils/aiGateway')
        const descriptionPreview = videoDescription ? videoDescription.slice(0, 500) : 'the video content'
        const prompt = `The user sent a YouTube video link. Video title: "${videoTitle}". Description preview: "${descriptionPreview}". 

Generate a friendly, conversational message that:
1. Identifies it as a YouTube video with the title
2. Summarizes what the video covers based on the description
3. Offers to provide a full detailed summary or create content from it

Keep it concise (2-3 sentences) and conversational.`

        try {
          const llmMessage = await callChatCompletions({
            messages: [
              { role: 'system', content: 'You are a helpful assistant that describes YouTube videos in a friendly, conversational way.' },
              ...conversationHistory,
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            maxTokens: 200
          })
          assistantMessages.push(llmMessage)
        } catch {
          // Fallback if LLM fails
          assistantMessages.push(`The link you sent is a YouTube video titled: "${videoTitle}". ${videoDescription ? `It covers: ${videoDescription.slice(0, 200)}...` : 'I\'m processing the video content.'} If you want, I can give you a full detailed summary of everything in the video — just tell me!`)
        }
      } else if (item.sourceType === 'manual_transcript') {
        // Generate descriptive message for transcript
        const transcriptPreview = item.source.sourceText ? item.source.sourceText.slice(0, 1000) : ''
        const { callChatCompletions } = await import('~~/server/utils/aiGateway')

        const prompt = `The user shared a transcript. Transcript preview: "${transcriptPreview}"

Generate a friendly, conversational message that:
1. Acknowledges the transcript
2. Summarizes what it appears to be about
3. Mentions key topics or themes
4. Offers to create a draft from it

Keep it concise (2-3 sentences) and conversational.`

        try {
          const llmMessage = await callChatCompletions({
            messages: [
              { role: 'system', content: 'You are a helpful assistant that describes transcripts in a friendly, conversational way.' },
              ...conversationHistory,
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            maxTokens: 200
          })
          assistantMessages.push(llmMessage)
        } catch {
          // Fallback if LLM fails
          const wordCount = transcriptPreview.split(/\s+/).length
          assistantMessages.push(`I see you've shared a transcript (${wordCount} words). I'm processing it and will be ready to create content from it shortly. If you want, I can create a draft from this transcript — just let me know!`)
        }
      } else {
        // Generic message for other source types
        const typeLabel = item.sourceType.replace('_', ' ')
        assistantMessages.push(`Saved your ${typeLabel} for this organization. I can help you create content from it if you'd like.`)
      }
    }
  }

  if (generationResult) {
    assistantMessages.push('Your draft is ready, let me know if you want edits to specific sections.')
  }

  if (patchSectionResult) {
    const sectionLabel = (body.action?.type === 'patch_section' && body.action.sectionTitle) || patchSectionResult.section?.title || 'that section'
    assistantMessages.push(`Updated "${sectionLabel}". Refresh the draft to review the latest changes.`)
  }

  if (assistantMessages.length === 0) {
    assistantMessages.push('Got it. I\'m ready whenever you want to start a draft or share a link.')
  }

  const assistantMessageBody = assistantMessages.join(' ')

  if (assistantMessageBody) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: assistantMessageBody
    })
  }

  if (completionMessages?.summary) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.summary.content,
      payload: completionMessages.summary.payload
    })
  }

  if (completionMessages?.files) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: completionMessages.files.content,
      payload: completionMessages.files.payload
    })
  }

  const messages = await getSessionMessages(db, session.id, organizationId)
  const logs = await getSessionLogs(db, session.id, organizationId)

  return {
    assistantMessage: assistantMessageBody,
    sources: processedSources.map(item => ({
      ...item.source,
      originalUrl: item.url
    })),
    generation: generationResult
      ? {
          content: generationResult.content,
          version: generationResult.version,
          markdown: generationResult.markdown,
          meta: generationResult.meta
        }
      : null,
    sessionId: session.id,
    sessionContentId: session.contentId ?? null,
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
    })),
    actions: actionSuggestions
  }
})
