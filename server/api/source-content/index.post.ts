import type { UpsertSourceContentRequestBody } from '~~/server/types/sourceContent'
import { readBody } from 'h3'
import { INGEST_STATUSES, upsertSourceContent } from '~~/server/services/sourceContent'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateEnum, validateOptionalString, validateRequestBody, validateRequiredString } from '~~/server/utils/validation'

/**
 * Creates or updates source content
 *
 * @description Creates or updates a source content record based on sourceType and externalId
 *
 * @param sourceType - Type of source (youtube, manual_transcript, etc.) (required)
 * @param externalId - External ID (e.g., YouTube video ID)
 * @param title - Title of the source content
 * @param sourceText - Source text/transcript
 * @param metadata - Additional metadata
 * @param ingestStatus - Ingest status (pending, processing, ingested, failed)
 * @returns Created or updated source content record
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const body = await readBody<UpsertSourceContentRequestBody>(event)

  validateRequestBody(body)

  const sourceType = validateRequiredString(body.sourceType, 'sourceType')

  let ingestStatus: typeof INGEST_STATUSES[number] | undefined
  if (body.ingestStatus !== undefined && body.ingestStatus !== null) {
    ingestStatus = validateEnum(body.ingestStatus, INGEST_STATUSES, 'ingestStatus')
  }

  // Validate optional fields
  const externalId = validateOptionalString(body.externalId, 'externalId')
  const title = validateOptionalString(body.title, 'title')
  const sourceText = validateOptionalString(body.sourceText, 'sourceText')

  // Validate metadata
  if (body.metadata !== undefined && body.metadata !== null && (typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
    throw createValidationError('metadata must be an object or null')
  }

  const record = await upsertSourceContent(db, {
    organizationId,
    userId: user.id,
    sourceType,
    externalId: externalId ?? undefined,
    title: title ?? undefined,
    sourceText: sourceText ?? undefined,
    metadata: body.metadata ?? undefined,
    ingestStatus: ingestStatus ?? undefined
  })

  return record
})
