import type { CreateContentRequestBody } from '~~/server/types/content'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  ensureUniqueContentSlug,
  resolveIngestMethodFromSourceContent,
  slugifyTitle
} from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { createInternalError, createNotFoundError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateEnum, validateOptionalString, validateOptionalUUID, validateRequestBody, validateRequiredString } from '~~/server/utils/validation'

/**
 * Creates a new content record
 *
 * @description Creates a content record with the specified title, status, and contentType
 *
 * @param title - Title of the content (required)
 * @param slug - Slug for the content (auto-generated from title if not provided)
 * @param status - Status of the content (required)
 * @param contentType - Type of content (required)
 * @param sourceContentId - Optional ID of source content to link
 * @returns Created content record
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const body = await readBody<CreateContentRequestBody>(event)

  validateRequestBody(body)

  // Conversation quota is checked at chat session creation, not here
  // Content creation can happen as part of existing conversations

  const title = validateRequiredString(body.title, 'title')

  let sourceContentId: string | null = null
  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null

  const sourceContentIdInput = validateOptionalUUID(body.sourceContentId, 'sourceContentId')
  if (sourceContentIdInput) {
    const [sourceContentRecord] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, sourceContentIdInput))
      .limit(1)

    if (!sourceContentRecord || sourceContentRecord.organizationId !== organizationId) {
      throw createNotFoundError('Source content', sourceContentIdInput)
    }

    sourceContent = sourceContentRecord
    sourceContentId = sourceContentRecord.id
  }

  const baseSlug = body.slug
    ? slugifyTitle(body.slug)
    : slugifyTitle(title)

  const status = validateEnum(body.status, CONTENT_STATUSES, 'status')
  const contentType = validateEnum(body.contentType, CONTENT_TYPES, 'contentType')

  const ingestMethod = resolveIngestMethodFromSourceContent(sourceContent)

  const slug = await ensureUniqueContentSlug(db, organizationId, baseSlug)

  const [createdRecord] = await db
    .insert(schema.content)
    .values({
      id: uuidv7(),
      organizationId,
      createdByUserId: user.id,
      sourceContentId,
      ingestMethod,
      title,
      slug,
      status,
      primaryKeyword: validateOptionalString(body.primaryKeyword, 'primaryKeyword'),
      targetLocale: validateOptionalString(body.targetLocale, 'targetLocale'),
      contentType,
      currentVersionId: null
    })
    .returning()

  if (!createdRecord) {
    throw createInternalError('Failed to create content record')
  }

  return createdRecord
})
