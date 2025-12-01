import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'
import {
  addChatLog,
  addChatMessage,
  ensureChatSession,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { generateContentDraft, patchContentSection } from '~~/server/services/content/generation'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createManualTranscriptSourceContent } from '~~/server/services/sourceContent/manualTranscript'
import { ingestYouTubeSource } from '~~/server/services/sourceContent/youtubeIngest'
import { requireAuth } from '~~/server/utils/auth'
import { classifyUrl, extractUrls } from '~~/server/utils/chat'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

interface ChatActionGenerateContent {
  type: 'generate_content'
  sourceContentId?: string | null
  contentId?: string | null
  transcript?: string | null
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  systemPrompt?: string
  temperature?: number
}

interface ChatActionPatchSection {
  type: 'patch_section'
  contentId?: string | null
  sectionId?: string | null
  sectionTitle?: string | null
  instructions?: string | null
  temperature?: number
}

type ChatAction = ChatActionGenerateContent | ChatActionPatchSection

interface ChatRequestBody {
  message: string
  action?: ChatAction
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const body = await readBody<ChatRequestBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  const message = typeof body.message === 'string' ? body.message : ''

  if (!message.trim() && !body.action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message or action is required'
    })
  }

  const urls = extractUrls(message)
  const seenKeys = new Set<string>()
  const processedSources: Array<{
    source: Awaited<ReturnType<typeof upsertSourceContent>>
    url: string
    sourceType: string
  }> = []

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

    if (classification.sourceType === 'youtube' && classification.externalId && runtimeConfig.enableYoutubeIngestion) {
      try {
        record = await ingestYouTubeSource({
          db,
          sourceContentId: record.id,
          organizationId,
          userId: user.id,
          videoId: classification.externalId
        })
      } catch (error) {
        console.error('YouTube ingest failed', {
          sourceContentId: record.id,
          error
        })
      }
    } else if (classification.sourceType === 'youtube' && !runtimeConfig.enableYoutubeIngestion) {
      console.log('YouTube ingestion disabled by feature flag, skipping ingest for:', record.id)
    }

    processedSources.push({
      source: record,
      url: rawUrl,
      sourceType: classification.sourceType
    })

    seenKeys.add(key)
  }

  const actions = processedSources.map(item => ({
    type: 'suggest_generate_from_source',
    sourceContentId: item.source.id,
    sourceType: item.sourceType,
    label: `Start a draft from this ${item.sourceType.replace('_', ' ')}`
  }))

  let resolvedSourceContentId = body.action?.sourceContentId ?? processedSources[0]?.source.id ?? null

  let generationResult: Awaited<ReturnType<typeof generateContentDraft>> | null = null
  let patchSectionResult: Awaited<ReturnType<typeof patchContentSection>> | null = null

  if (body.action?.type === 'generate_content') {
    if (!resolvedSourceContentId) {
      if (typeof body.action.transcript !== 'string' || !body.action.transcript.trim()) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Provide a transcript or select an existing source.'
        })
      }

      const manualSource = await createManualTranscriptSourceContent({
        db,
        organizationId,
        userId: user.id,
        transcript: body.action.transcript,
        metadata: { createdVia: 'chat_generate_action' }
      })

      resolvedSourceContentId = manualSource.id
    }
  }

  const initialSessionContentId = typeof body.action?.contentId === 'string'
    ? body.action.contentId
    : null

  const sessionSourceId = resolvedSourceContentId ?? null

  let session = await ensureChatSession(db, {
    organizationId,
    contentId: initialSessionContentId,
    sourceContentId: sessionSourceId,
    createdByUserId: user.id,
    metadata: {
      lastAction: body.action?.type ?? (message.trim() ? 'message' : null)
    }
  })

  if (body.action?.type === 'generate_content') {
    let sanitizedSystemPrompt: string | undefined
    if (body.action.systemPrompt !== undefined) {
      if (typeof body.action.systemPrompt !== 'string') {
        throw createError({
          statusCode: 400,
          statusMessage: 'systemPrompt must be a string when provided'
        })
      }
      const trimmed = body.action.systemPrompt.trim()
      if (!trimmed) {
        throw createError({
          statusCode: 400,
          statusMessage: 'systemPrompt cannot be empty'
        })
      }
      sanitizedSystemPrompt = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed
    }

    let sanitizedTemperature = 1
    if (body.action.temperature !== undefined && body.action.temperature !== null) {
      const parsedTemperature = Number(body.action.temperature)
      if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
        throw createError({
          statusCode: 400,
          statusMessage: 'temperature must be a number between 0 and 2'
        })
      }
      sanitizedTemperature = parsedTemperature
    }

    generationResult = await generateContentDraft(db, {
      organizationId,
      userId: user.id,
      sourceContentId: resolvedSourceContentId,
      contentId: body.action.contentId ?? null,
      overrides: {
        title: typeof body.action.title === 'string' ? body.action.title : null,
        slug: typeof body.action.slug === 'string' ? body.action.slug : null,
        status: body.action.status && CONTENT_STATUSES.includes(body.action.status) ? body.action.status : undefined,
        primaryKeyword: typeof body.action.primaryKeyword === 'string' ? body.action.primaryKeyword : null,
        targetLocale: typeof body.action.targetLocale === 'string' ? body.action.targetLocale : null,
        contentType: body.action.contentType && CONTENT_TYPES.includes(body.action.contentType) ? body.action.contentType : undefined
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
        const summaryLines = [
          'Plan preview before drafting the full blog:',
          `Title: ${frontmatter.title}`,
          `Schema types: ${schemaSummary}`,
          `Slug suggestion: ${frontmatter.slugSuggestion}`,
          outlinePreview ? `Outline:\n${outlinePreview}` : 'Outline: (not provided)'
        ]
        await addChatMessage(db, {
          sessionId: session.id,
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
  }

  if (body.action?.type === 'patch_section') {
    const instructions = (typeof body.action.instructions === 'string' ? body.action.instructions : message).trim()
    if (!instructions) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Instructions are required to update a section.'
      })
    }

    const contentIdToPatch = typeof body.action.contentId === 'string' ? body.action.contentId : null
    const sectionIdToPatch = typeof body.action.sectionId === 'string' ? body.action.sectionId : null

    if (!contentIdToPatch || !sectionIdToPatch) {
      throw createError({
        statusCode: 400,
        statusMessage: 'contentId and sectionId are required to patch a section.'
      })
    }

    const temperature = typeof body.action.temperature === 'number' && Number.isFinite(body.action.temperature)
      ? body.action.temperature
      : undefined

    patchSectionResult = await patchContentSection(db, {
      organizationId,
      userId: user.id,
      contentId: contentIdToPatch,
      sectionId: sectionIdToPatch,
      instructions,
      temperature
    })

    await addChatLog(db, {
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
    await addChatMessage(db, {
      sessionId: session.id,
      organizationId,
      role: 'user',
      content: message.trim()
    })
    await addChatLog(db, {
      sessionId: session.id,
      organizationId,
      type: 'user_message',
      message: 'User sent a chat prompt'
    })
  }

  if (processedSources.length > 0) {
    await addChatLog(db, {
      sessionId: session.id,
      organizationId,
      type: 'source_detected',
      message: `Detected ${processedSources.length} source link${processedSources.length > 1 ? 's' : ''}`,
      payload: {
        sources: processedSources.map(item => ({
          id: item.source.id,
          sourceType: item.sourceType,
          url: item.url
        }))
      }
    })
  }

  if (generationResult) {
    await addChatLog(db, {
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

  const assistantMessages: string[] = []

  if (processedSources.length > 0) {
    assistantMessages.push(`I saved ${processedSources.length} source link${processedSources.length > 1 ? 's' : ''} for this organization.`)
  }

  if (generationResult) {
    assistantMessages.push('Your draft is ready, let me know if you want edits to specific sections.')
  }

  if (patchSectionResult) {
    const sectionLabel = body.action?.sectionTitle || patchSectionResult.section?.title || 'that section'
    assistantMessages.push(`Updated "${sectionLabel}". Refresh the draft to review the latest changes.`)
  }

  if (assistantMessages.length === 0) {
    assistantMessages.push('Got it. I\'m ready whenever you want to start a draft or share a link.')
  }

  const assistantMessageBody = assistantMessages.join(' ')

  if (assistantMessageBody) {
    await addChatMessage(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: assistantMessageBody
    })
  }

  const messages = await getSessionMessages(db, session.id, organizationId)
  const logs = await getSessionLogs(db, session.id, organizationId)

  return {
    assistantMessage: assistantMessageBody,
    actions,
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
    }))
  }
})
