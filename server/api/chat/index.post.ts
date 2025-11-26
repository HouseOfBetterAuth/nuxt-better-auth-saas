import {
  addChatLog,
  addChatMessage,
  ensureChatSession,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { generateContentDraft } from '~~/server/services/content/generation'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { ingestYouTubeSource } from '~~/server/services/sourceContent/youtubeIngest'
import { requireAuth } from '~~/server/utils/auth'
import { classifyUrl, extractUrls } from '~~/server/utils/chat'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface ChatActionGenerateContent {
  type: 'generate_content'
  sourceContentId?: string | null
  contentId?: string | null
  text?: string | null
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  systemPrompt?: string
  temperature?: number
}

type ChatAction = ChatActionGenerateContent

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

    if (classification.sourceType === 'youtube' && classification.externalId) {
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

  let generationResult: Awaited<ReturnType<typeof generateContentDraft>> | null = null

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
      text: body.action.text ?? null,
      sourceContentId: body.action.sourceContentId ?? null,
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
      temperature: sanitizedTemperature
    })
  }

  const sessionContentId = body.action?.contentId ?? generationResult?.content?.id ?? null
  const sessionSourceId = body.action?.sourceContentId ?? processedSources[0]?.source.id ?? null

  const session = await ensureChatSession(db, {
    organizationId,
    contentId: sessionContentId,
    sourceContentId: sessionSourceId,
    createdByUserId: user.id,
    metadata: {
      lastAction: body.action?.type ?? (message.trim() ? 'message' : null)
    }
  })

  if (message.trim()) {
    await db.transaction(async (tx) => {
      await addChatMessage(tx, {
        sessionId: session.id,
        organizationId,
        role: 'user',
        content: message.trim()
      })
      await addChatLog(tx, {
        sessionId: session.id,
        organizationId,
        type: 'user_message',
        message: 'User sent a chat prompt'
      })
    })
  }

  if (processedSources.length > 0) {
    await db.transaction(async (tx) => {
      await addChatLog(tx, {
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
    })
  }

  if (generationResult) {
    await db.transaction(async (tx) => {
      await addChatLog(tx, {
        sessionId: session.id,
        organizationId,
        type: 'generation_complete',
        message: 'Draft generation completed',
        payload: {
          contentId: generationResult.content.id,
          versionId: generationResult.version.id
        }
      })
    })
  }

  const assistantMessages: string[] = []

  if (processedSources.length > 0) {
    assistantMessages.push(`I saved ${processedSources.length} source link${processedSources.length > 1 ? 's' : ''} for this organization.`)
  }

  if (generationResult) {
    assistantMessages.push('Your draft is ready, let me know if you want edits to specific sections.')
  }

  if (assistantMessages.length === 0) {
    assistantMessages.push('Got it. I\'m ready whenever you want to start a draft or share a link.')
  }

  const assistantMessageBody = assistantMessages.join(' ')

  if (assistantMessageBody) {
    await db.transaction(async (tx) => {
      await addChatMessage(tx, {
        sessionId: session.id,
        organizationId,
        role: 'assistant',
        content: assistantMessageBody
      })
    })
  }

  const messages = await getSessionMessages(db, session.id, organizationId, { limit: 50 })
  const logs = await getSessionLogs(db, session.id, organizationId, { limit: 100 })

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
    messages: messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
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
