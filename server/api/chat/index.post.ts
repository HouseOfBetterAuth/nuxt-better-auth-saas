import type { upsertSourceContent } from '~~/server/services/sourceContent'
import type { ChatRequestBody } from '~~/server/types/api'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
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
import { buildSourceSummaryPreview, buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { ensureAccessToken, fetchYouTubeVideoMetadata, findYouTubeAccount } from '~~/server/services/sourceContent/youtubeIngest'
import { getAuthSession, requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateEnum, validateNumber, validateOptionalUUID, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'
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

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const db = await useDB(event)

  // Try to get organizationId from session first (faster and more reliable)
  const authSession = await getAuthSession(event)
  let organizationId: string | null = (authSession?.session as any)?.activeOrganizationId || null

  // If not in session, try to get from database via requireActiveOrganization
  if (!organizationId) {
    try {
      const orgResult = await requireActiveOrganization(event, user.id, { isAnonymousUser: user.isAnonymous })
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

  if (!trimmedMessage && !body.action) {
    throw createValidationError('Message or action is required')
  }

  const processedSources: Array<{
    source: Awaited<ReturnType<typeof upsertSourceContent>>
    url: string
    sourceType: string
  }> = []
  const ingestionErrors: Array<{ content: string, payload?: Record<string, any> | null }> = []
  const readySources: typeof schema.sourceContent.$inferSelect[] = []
  const newlyReadySources: typeof schema.sourceContent.$inferSelect[] = []
  const readySourceIds = new Set<string>()

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

  let resolvedSourceContentId = (body.action?.type === 'generate_content' && body.action.sourceContentId)
    ? validateOptionalUUID(body.action.sourceContentId, 'action.sourceContentId')
    : processedSources[0]?.source?.id ?? null

  const requestContentId = (body as any).contentId
    ? validateOptionalUUID((body as any).contentId, 'contentId')
    : null

  // Determine session contentId: action.contentId takes precedence for both generate_content and patch_section
  const initialSessionContentId = (body.action?.type === 'generate_content' && body.action.contentId)
    ? validateOptionalUUID(body.action.contentId, 'action.contentId')
    : (body.action?.type === 'patch_section' && body.action.contentId)
        ? validateOptionalUUID(body.action.contentId, 'action.contentId')
        : requestContentId

  let sessionSourceId = resolvedSourceContentId ?? null

  let session = null
  if (requestSessionId) {
    session = await getChatSessionById(db, requestSessionId, organizationId)
    if (!session) {
      console.warn(`Session ${requestSessionId} not found for organization ${organizationId}, creating new session`)
    }
  }

  if (!session) {
    session = await getOrCreateChatSessionForContent(db, {
      organizationId,
      contentId: initialSessionContentId,
      sourceContentId: sessionSourceId,
      createdByUserId: user.id,
      metadata: {
        lastAction: body.action?.type ?? (trimmedMessage ? 'message' : null)
      }
    })
  }

  if (!session) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create chat session'
    })
  }

  if (!sessionSourceId && session.sourceContentId) {
    sessionSourceId = session.sourceContentId
  }

  if (sessionSourceId && !readySourceIds.has(sessionSourceId)) {
    const existingSource = processedSources.find(item => item.source.id === sessionSourceId)?.source
    if (existingSource) {
      trackReadySource(existingSource)
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
        trackReadySource(sessionSource)
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
        // Default to 'blog_post' if contentType is not provided (most common use case)
        contentType: generateAction.contentType
          ? validateEnum(generateAction.contentType, CONTENT_TYPES, 'contentType')
          : DEFAULT_CONTENT_TYPE
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
        const targetSourceId = resolvedSourceContentId ?? session.sourceContentId ?? null
        let previewPayload = null
        if (targetSourceId) {
          let previewSource = readySources.find(source => source.id === targetSourceId)
            ?? processedSources.find(item => item.source?.id === targetSourceId)?.source
            ?? null
          if (!previewSource) {
            const [sourceRecord] = await db
              .select()
              .from(schema.sourceContent)
              .where(and(
                eq(schema.sourceContent.id, targetSourceId),
                eq(schema.sourceContent.organizationId, organizationId)
              ))
              .limit(1)
            previewSource = sourceRecord ?? null
          }
          previewPayload = buildSourceSummaryPreview({ sourceContent: previewSource })
        }
        await addMessageToChatSession(db, {
          sessionId: planPreviewSessionId,
          organizationId,
          role: 'assistant',
          content: summaryLines.join('\n\n'),
          payload: {
            type: 'plan_preview',
            plan,
            frontmatter,
            preview: previewPayload,
            sourceId: targetSourceId
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

  if (trimmedMessage) {
    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'user',
      content: trimmedMessage
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

  // Build context for LLM to generate a single coherent assistant message
  const contextParts: string[] = []

  // Add information about processed sources
  if (processedSources.length > 0) {
    for (const item of processedSources) {
      if (!item.source) {
        continue
      }
      if (item.sourceType === 'youtube' && item.source.externalId) {
        // Try to fetch YouTube video metadata
        let videoTitle = 'YouTube video'
        let videoDescription = ''

        try {
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

        const safeTitle = sanitizePromptSnippet(videoTitle, 200) || 'YouTube video'
        const safeDescription = sanitizePromptSnippet(videoDescription, 500)
        if (safeDescription) {
          contextParts.push(`User shared a YouTube video:\n"""${safeTitle}"""\nDescription:\n"""${safeDescription}"""`)
        } else {
          contextParts.push(`User shared a YouTube video:\n"""${safeTitle}"""\nVideo content is being processed.`)
        }
      } else if (item.sourceType === 'manual_transcript') {
        const fullText = item.source.sourceText ?? ''
        const wordCount = fullText.split(/\s+/).filter(Boolean).length
        const transcriptPreview = sanitizePromptSnippet(fullText, 1000)
        const previewBlock = transcriptPreview ? `\nPreview:\n"""${transcriptPreview}"""` : ''
        contextParts.push(`User shared a transcript (~${wordCount} words).${previewBlock}`)
      } else {
        const typeLabel = item.sourceType.replace('_', ' ')
        contextParts.push(`User shared a ${typeLabel} source.`)
      }
    }
  }

  // Add information about ready sources (ingested and ready for drafting)
  if (!generationResult && readySources.length > 0) {
    for (const source of readySources) {
      const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : null
      const typeLabel = source.sourceType?.replace('_', ' ') || 'source'
      const intro = title ? `${title} (${typeLabel})` : typeLabel
      contextParts.push(`Source ready for drafting: ${intro}.`)
    }
  }

  // Add information about generation results
  if (generationResult) {
    contextParts.push('A draft has been successfully generated and is ready for review.')
  }

  // Add information about section patches
  if (patchSectionResult) {
    const sectionLabel = (body.action?.type === 'patch_section' && body.action.sectionTitle) || patchSectionResult.section?.title || 'a section'
    contextParts.push(`Updated ${sectionLabel} in the draft.`)
  }

  const shouldSkipAssistantResponse = false

  // Generate a single coherent assistant message using LLM
  let assistantMessageBody = ''
  if (!shouldSkipAssistantResponse && (contextParts.length > 0 || trimmedMessage)) {
    const { callChatCompletions } = await import('~~/server/utils/aiGateway')
    const contextText = contextParts.length > 0 ? `Context:\n${contextParts.join('\n\n')}` : ''
    const userMessage = wrapPromptSnippet('User message', trimmedMessage, 1500) || 'User sent a message or action.'

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
      // Minimal fallback - just acknowledge
      if (generationResult) {
        assistantMessageBody = 'Your draft is ready, let me know if you want edits to specific sections.'
      } else if (readySources.length > 0) {
        const sourceNames = readySources.map(s => s.title || s.sourceType).join(', ')
        assistantMessageBody = `I've processed ${sourceNames}. Want me to create a blog draft from it?`
      } else if (processedSources.length > 0) {
        assistantMessageBody = 'I\'ve saved your source. I can help you create a blog draft from it — just let me know!'
      } else {
        assistantMessageBody = 'Got it. I\'m ready whenever you want to start a draft or share a link.'
      }
    }
  } else if (!shouldSkipAssistantResponse) {
    assistantMessageBody = 'Got it. I\'m ready whenever you want to start a draft or share a link.'
  }

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
    }))
  }
})
