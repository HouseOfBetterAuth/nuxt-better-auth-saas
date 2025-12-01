import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams, readBody } from 'h3'
import * as schema from '~~/server/database/schema'
import { addChatLog, addChatMessage, getSessionMessages } from '~~/server/services/chatSession'
import { generateContentDraft } from '~~/server/services/content/generation'
import { createManualTranscriptSourceContent } from '~~/server/services/sourceContent/manualTranscript'
import { requireAuth } from '~~/server/utils/auth'
import { CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface CreateContentFromChatBody {
  title: string
  contentType?: typeof CONTENT_TYPES[number]
  messageIds?: string[]
}

const MAX_MESSAGE_COUNT = 200
const MAX_TRANSCRIPT_LENGTH = 12000

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const { sessionId } = getRouterParams(event)

  if (!sessionId || typeof sessionId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid sessionId is required'
    })
  }

  const body = await readBody<CreateContentFromChatBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  if (!body.title || typeof body.title !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'title is required'
    })
  }

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
      eq(schema.contentChatSession.id, sessionId),
      eq(schema.contentChatSession.organizationId, organizationId)
    ))
    .limit(1)

  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat session not found'
    })
  }

  if (session.contentId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This conversation is already linked to a draft.'
    })
  }

  const contentType = body.contentType && CONTENT_TYPES.includes(body.contentType)
    ? body.contentType
    : 'blog_post'

  const allMessages = await getSessionMessages(db, session.id, organizationId)

  if (!allMessages.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No conversation history found for this session.'
    })
  }

  const allowedIds = new Set(body.messageIds)
  const selectedMessages = allMessages.filter(message => allowedIds.has(message.id))

  if (!selectedMessages.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to find the specified messages for this session.'
    })
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
    throw createError({
      statusCode: 400,
      statusMessage: 'Conversation transcript is empty.'
    })
  }

  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transcript is too long. Deselect some messages and try again.'
    })
  }

  const manualSource = await createManualTranscriptSourceContent({
    db,
    organizationId,
    userId: user.id,
    transcript,
    metadata: { createdVia: 'chat_session_create_content', sessionId: session.id }
  })

  const result = await generateContentDraft(db, {
    organizationId,
    userId: user.id,
    sourceContentId: manualSource.id,
    overrides: {
      title: body.title,
      contentType
    },
    onPlanReady: async ({ plan, frontmatter }) => {
      if (!plan || typeof plan !== 'object') {
        console.warn('[create-content] Missing plan data in onPlanReady callback.')
        return
      }

      if (!frontmatter || typeof frontmatter !== 'object') {
        console.warn('[create-content] Missing frontmatter data in onPlanReady callback.')
        return
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

  await addChatLog(db, {
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
