import type { GenerateContentDraftFromSourceRequestBody } from '~~/server/types/content'
import { generateContentDraftFromSource } from '~~/server/services/content/generation'
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
    resolvedSourceContentId = manualSource.id
  }

  const validatedContentId = validateOptionalUUID(body.contentId, 'contentId')

  const result = await generateContentDraftFromSource(db, {
    organizationId,
    userId: user.id,
    sourceContentId: resolvedSourceContentId,
    contentId: validatedContentId,
    overrides,
    systemPrompt: body.systemPrompt,
    temperature: body.temperature
  })

  return {
    content: result.content,
    version: result.version,
    markdown: result.markdown,
    meta: result.meta
  }
})
