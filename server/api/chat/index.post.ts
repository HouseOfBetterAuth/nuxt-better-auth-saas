import type { ChatRequestBody } from '~~/server/types/api'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import {
  addLogEntryToChatSession,
  addMessageToChatSession,
  getOrCreateChatSessionForContent,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { generateContentDraftFromSource, updateContentSectionWithAI } from '~~/server/services/content/generation'
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

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
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
      record = await ingestYouTubeVideoAsSourceContent({
        db,
        sourceContentId: record.id,
        organizationId,
        userId: user.id,
        videoId: classification.externalId
      })
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

      processedSources.push({
        source: manualSource,
        url: '',
        sourceType: 'manual_transcript'
      })
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

      processedSources.push({
        source: manualSource,
        url: '',
        sourceType: 'manual_transcript'
      })
    }
  }

  let resolvedSourceContentId = body.action?.sourceContentId
    ? validateOptionalUUID(body.action.sourceContentId, 'action.sourceContentId')
    : processedSources[0]?.source.id ?? null

  const initialSessionContentId = body.action?.contentId
    ? validateOptionalUUID(body.action.contentId, 'action.contentId')
    : null

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

  let generationResult: Awaited<ReturnType<typeof generateContentDraftFromSource>> | null = null
  let patchSectionResult: Awaited<ReturnType<typeof updateContentSectionWithAI>> | null = null

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
          await addMessageToChatSession(db, {
            sessionId: session.id,
            organizationId,
            role: 'assistant',
            content: progressMessage
          })
        }
      })

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
    let sanitizedSystemPrompt: string | undefined
    if (body.action.systemPrompt !== undefined) {
      const trimmed = validateRequiredString(body.action.systemPrompt, 'systemPrompt')
      sanitizedSystemPrompt = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed
    }

    let sanitizedTemperature = 1
    if (body.action.temperature !== undefined && body.action.temperature !== null) {
      sanitizedTemperature = validateNumber(body.action.temperature, 'temperature', 0, 2)
    }

    generationResult = await generateContentDraftFromSource(db, {
      organizationId,
      userId: user.id,
      sourceContentId: resolvedSourceContentId,
      contentId: body.action.contentId ?? null,
      overrides: {
        title: body.action.title ? validateRequiredString(body.action.title, 'title') : null,
        slug: body.action.slug ? validateRequiredString(body.action.slug, 'slug') : null,
        status: body.action.status ? validateEnum(body.action.status, CONTENT_STATUSES, 'status') : undefined,
        primaryKeyword: body.action.primaryKeyword ? validateRequiredString(body.action.primaryKeyword, 'primaryKeyword') : null,
        targetLocale: body.action.targetLocale ? validateRequiredString(body.action.targetLocale, 'targetLocale') : null,
        contentType: body.action.contentType ? validateEnum(body.action.contentType, CONTENT_TYPES, 'contentType') : undefined
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
          `Plan preview before drafting the full ${contentType}:`,
          `Title: ${frontmatter.title ?? 'Untitled draft'}`,
          schemaSummary ? `Schema types: ${schemaSummary}` : 'Schema types: n/a',
          frontmatter.slugSuggestion ? `Slug suggestion: ${frontmatter.slugSuggestion}` : 'Slug suggestion: n/a',
          outlinePreview ? `Outline:\n${outlinePreview}` : 'Outline: (not provided)',
          'Tell me if you want any tweaks to this outline—or hit “Start draft in workspace” when you’re ready for the full article.'
        ]
        await addMessageToChatSession(db, {
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
    await addLogEntryToChatSession(db, {
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

  const assistantMessages: string[] = []

  if (processedSources.length > 0) {
    // Generate descriptive messages for each source
    for (const item of processedSources) {
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
            systemPrompt: 'You are a helpful assistant that describes YouTube videos in a friendly, conversational way.',
            userPrompt: prompt,
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
            systemPrompt: 'You are a helpful assistant that describes transcripts in a friendly, conversational way.',
            userPrompt: prompt,
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
    const sectionLabel = body.action?.sectionTitle || patchSectionResult.section?.title || 'that section'
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
