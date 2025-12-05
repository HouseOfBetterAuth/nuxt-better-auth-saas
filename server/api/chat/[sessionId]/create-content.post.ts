import type { CreateContentFromChatRequestBody } from '~~/server/types/content'
import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams, readBody } from 'h3'
import * as schema from '~~/server/database/schema'
import { addLogEntryToChatSession, addMessageToChatSession, getSessionMessages } from '~~/server/services/chatSession'
import { generateContentDraftFromSource } from '~~/server/services/content/generation'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { ensureEmailVerifiedDraftCapacity, requireAuth } from '~~/server/utils/auth'
import { CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createInternalError, createNotFoundError, createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateEnum, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'
import { DEFAULT_CONTENT_TYPE } from '~~/shared/constants/contentTypes'

const MAX_MESSAGE_COUNT = 200
// Removed MAX_TRANSCRIPT_LENGTH - transcripts are chunked and vectorized, so length limits are unnecessary

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const { sessionId } = getRouterParams(event)
  const validatedSessionId = validateUUID(sessionId, 'sessionId')

  const body = await readBody<CreateContentFromChatRequestBody>(event)

  validateRequestBody(body)

  await ensureEmailVerifiedDraftCapacity(db, organizationId, user, event)

  const title = validateRequiredString(body.title, 'title')

  if (!Array.isArray(body.messageIds) || body.messageIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Select at least one message to build from.'
    })
  }

  if (body.messageIds.length > MAX_MESSAGE_COUNT) {
    throw createError({
      statusCode: 400,
      statusMessage: `Select ${MAX_MESSAGE_COUNT} messages or fewer before creating a draft.`
    })
  }

  const [session] = await db
    .select()
    .from(schema.contentChatSession)
    .where(and(
      eq(schema.contentChatSession.id, validatedSessionId),
      eq(schema.contentChatSession.organizationId, organizationId)
    ))
    .limit(1)

  if (!session) {
    throw createNotFoundError('Chat session', validatedSessionId)
  }

  if (session.contentId) {
    throw createValidationError('This conversation is already linked to a draft.')
  }

  const contentType = body.contentType
    ? validateEnum(body.contentType, CONTENT_TYPES, 'contentType')
    : DEFAULT_CONTENT_TYPE

  const allMessages = await getSessionMessages(db, session.id, organizationId)

  if (!allMessages.length) {
    throw createValidationError('No conversation history found for this session.')
  }

  const allowedIds = new Set(body.messageIds)
  const selectedMessages = allMessages.filter(message => allowedIds.has(message.id))

  if (!selectedMessages.length) {
    throw createValidationError('Unable to find the specified messages for this session.')
  }

  const transcript = selectedMessages
    .map((message) => {
      const speaker = message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'user'
          ? 'User'
          : 'System'
      return `${speaker}: ${message.content}`
    })
    .join('\n\n')
    .trim()

  if (!transcript) {
    throw createValidationError('Conversation transcript is empty.')
  }

  // Transcript length check removed - transcripts are automatically chunked and vectorized
  // regardless of length, so no artificial limits are needed

  await addMessageToChatSession(db, {
    sessionId: session.id,
    organizationId,
    role: 'assistant',
    content: 'Processing your transcript... This may take a moment.'
  })

  const manualSource = await createSourceContentFromTranscript({
    db,
    organizationId,
    userId: user.id,
    transcript,
    metadata: { createdVia: 'chat_session_create_content', sessionId: session.id },
    onProgress: async (progressMessage) => {
      await addMessageToChatSession(db, {
        sessionId: session.id,
        organizationId,
        role: 'assistant',
        content: progressMessage
      })
    }
  })

  if (!manualSource) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Manual source content is required'
    })
  }

  const result = await generateContentDraftFromSource(db, {
    organizationId,
    userId: user.id,
    sourceContentId: manualSource.id,
    event,
    overrides: {
      title,
      contentType
    },
    onPlanReady: async ({ plan, frontmatter }) => {
      if (!plan || typeof plan !== 'object') {
        const errorMessage = 'Failed to generate content plan. The plan data is missing. Please try again.'
        console.error('[create-content] Missing plan data in onPlanReady callback.', {
          sessionId: session.id,
          userId: user.id
        })
        await addMessageToChatSession(db, {
          sessionId: session.id,
          organizationId,
          role: 'assistant',
          content: errorMessage
        })
        throw createInternalError(errorMessage)
      }

      if (!frontmatter || typeof frontmatter !== 'object') {
        const errorMessage = 'Failed to generate content plan. The frontmatter data is missing. Please try again.'
        console.error('[create-content] Missing frontmatter data in onPlanReady callback.', {
          sessionId: session.id,
          userId: user.id
        })
        await addMessageToChatSession(db, {
          sessionId: session.id,
          organizationId,
          role: 'assistant',
          content: errorMessage
        })
        throw createInternalError(errorMessage)
      }

      const outlineArray = Array.isArray(plan.outline) ? plan.outline : []
      const outlinePreview = outlineArray
        .map((section, index) => {
          const typeSuffix = section.type && section.type !== 'body' ? ` (${section.type})` : ''
          return `${index + 1}. ${section.title || `Section ${index + 1}`}${typeSuffix}`
        })
        .join('\n')
      const schemaSummary = Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes.join(', ') : ''
      const summaryLines = [
        `Plan preview before drafting the full ${contentType}:`,
        `Title: ${frontmatter.title ?? 'Untitled draft'}`,
        schemaSummary ? `Schema types: ${schemaSummary}` : 'Schema types: n/a',
        frontmatter.slugSuggestion ? `Slug suggestion: ${frontmatter.slugSuggestion}` : 'Slug suggestion: n/a',
        outlinePreview ? `Outline:\n${outlinePreview}` : 'Outline: (not provided)',
        'Let me know if you’d like any outline adjustments—or click “Start draft in workspace” when you are ready.'
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

  await db
    .update(schema.contentChatSession)
    .set({
      contentId: result.content.id,
      metadata: {
        ...(session.metadata ?? {}),
        linkedContentId: result.content.id,
        linkedAt: new Date().toISOString()
      },
      updatedAt: new Date()
    })
    .where(eq(schema.contentChatSession.id, session.id))

  await addLogEntryToChatSession(db, {
    sessionId: session.id,
    organizationId,
    type: 'content_created',
    message: `Created content draft "${result.content.title}" from this conversation`,
    payload: {
      contentId: result.content.id,
      contentType
    }
  })

  return {
    content: result.content,
    version: result.version,
    sessionId: session.id
  }
})
