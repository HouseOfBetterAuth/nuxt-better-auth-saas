import type { GenerateContentDraftFromSourceRequestBody } from '~~/server/types/content'
import * as schema from '~~/server/database/schema'
import { eq } from 'drizzle-orm'
import { addLogEntryToChatSession, addMessageToChatSession, getChatSessionById, getOrCreateChatSessionForContent } from '~~/server/services/chatSession'
import { generateContentDraftFromSource } from '~~/server/services/content/generation'
import { buildWorkspaceSummary } from '~~/server/services/content/workspaceSummary'
import { createSourceContentFromTranscript } from '~~/server/services/sourceContent/manualTranscript'
import { requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateEnum, validateOptionalString, validateOptionalUUID, validateRequestBody } from '~~/server/utils/validation'

/**
 * Generates a content draft from a source content (transcript, YouTube video, etc.)
 *
 * @description Either provide sourceContentId or transcript (which will create source content first)
 *
 * @param sourceContentId - ID of the source content to generate from
 * @param transcript - Alternative: raw transcript text (creates source content first)
 * @param contentType - Type of content to generate (blog_post, recipe, etc.)
 * @param title - Override title for the generated content
 * @param slug - Override slug for the generated content
 * @param status - Override status for the generated content
 * @param systemPrompt - Custom system prompt for AI generation
 * @param temperature - Temperature for AI generation (0-2)
 * @returns Generated content draft with markdown and metadata
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const body = await readBody<GenerateContentDraftFromSourceRequestBody>(event)

  validateRequestBody(body)

  const overrides = {
    title: validateOptionalString(body.title, 'title'),
    slug: validateOptionalString(body.slug, 'slug'),
    status: body.status ? validateEnum(body.status, CONTENT_STATUSES, 'status') : undefined,
    primaryKeyword: validateOptionalString(body.primaryKeyword, 'primaryKeyword'),
    targetLocale: validateOptionalString(body.targetLocale, 'targetLocale'),
    contentType: body.contentType ? validateEnum(body.contentType, CONTENT_TYPES, 'contentType') : undefined
  }

  let resolvedSourceContentId = validateOptionalUUID(body.sourceContentId, 'sourceContentId')
  const validatedContentId = validateOptionalUUID(body.contentId, 'contentId')
  const validatedSessionId = validateOptionalUUID(body.sessionId, 'sessionId')

  let session = validatedSessionId
    ? await getChatSessionById(db, validatedSessionId, organizationId)
    : null

  if (validatedSessionId && !session) {
    throw createValidationError('Chat session not found for this organization.')
  }

  if (!resolvedSourceContentId) {
    const transcript = validateOptionalString(body.transcript, 'transcript')
    if (!transcript) {
      throw createValidationError('Provide a transcript or an existing sourceContentId.')
    }

    const manualSource = await createSourceContentFromTranscript({
      db,
      organizationId,
      userId: user.id,
      transcript,
      metadata: { createdVia: 'content_generate_api' }
    })
    if (!manualSource) {
      throw createValidationError('Failed to store transcript source.')
    }
    resolvedSourceContentId = manualSource.id
  }

  if (!session) {
    session = await getOrCreateChatSessionForContent(db, {
      organizationId,
      contentId: validatedContentId ?? null,
      sourceContentId: resolvedSourceContentId ?? null,
      createdByUserId: user.id,
      metadata: { lastAction: 'content_generate_api' }
    })
  } else if (resolvedSourceContentId && session.sourceContentId !== resolvedSourceContentId) {
    const [updatedSession] = await db
      .update(schema.contentChatSession)
      .set({ sourceContentId: resolvedSourceContentId, updatedAt: new Date() })
      .where(eq(schema.contentChatSession.id, session.id))
      .returning()

    if (updatedSession) {
      session = updatedSession
    }
  }

  const result = await generateContentDraftFromSource(db, {
    organizationId,
    userId: user.id,
    sourceContentId: resolvedSourceContentId,
    contentId: validatedContentId,
    event,
    overrides,
    systemPrompt: body.systemPrompt,
    temperature: body.temperature
  })

  if (session && session.contentId !== result.content.id) {
    const [updatedSession] = await db
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
      .returning()

    if (updatedSession) {
      session = updatedSession
    }
  }

  if (session) {
    let sourceRecord: typeof schema.sourceContent.$inferSelect | null = null

    if (resolvedSourceContentId) {
      const [record] = await db
        .select()
        .from(schema.sourceContent)
        .where(eq(schema.sourceContent.id, resolvedSourceContentId))
        .limit(1)

      sourceRecord = record ?? null
    }

    const workspaceSummary = buildWorkspaceSummary({
      content: result.content,
      currentVersion: result.version,
      sourceContent: sourceRecord
    })
    const draftTitle = result.content.title || 'Untitled draft'
    const assistantSummary = workspaceSummary
      ? `Draft updated: ${workspaceSummary}`
      : `Draft "${draftTitle}" created from the provided source.`

    await addMessageToChatSession(db, {
      sessionId: session.id,
      organizationId,
      role: 'assistant',
      content: assistantSummary,
      payload: {
        type: 'workspace_summary',
        summary: workspaceSummary || `Draft "${draftTitle}" created.`
      }
    })

    await addLogEntryToChatSession(db, {
      sessionId: session.id,
      organizationId,
      type: 'content_generated',
      message: `Draft "${draftTitle}" created from source content`,
      payload: {
        contentId: result.content.id,
        sourceContentId: resolvedSourceContentId
      }
    })
  }

  return {
    content: result.content,
    version: result.version,
    markdown: result.markdown,
    meta: result.meta,
    sessionId: session?.id ?? null,
    sessionContentId: session?.contentId ?? null
  }
})
