import { INGEST_STATUSES, upsertSourceContent } from '~~/server/services/sourceContent'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface SourceContentRequestBody {
  sourceType: string
  externalId?: string | null
  title?: string | null
  sourceText?: string | null
  metadata?: Record<string, any> | null
  ingestStatus?: 'pending' | 'ingested' | 'failed'
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const body = await readBody<SourceContentRequestBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  if (!body?.sourceType || typeof body.sourceType !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType is required'
    })
  }

  let ingestStatus: SourceContentRequestBody['ingestStatus']

  if (body.ingestStatus !== undefined && body.ingestStatus !== null) {
    if (!INGEST_STATUSES.includes(body.ingestStatus)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'ingestStatus must be pending, ingested, or failed'
      })
    }
    ingestStatus = body.ingestStatus
  }

  const record = await upsertSourceContent(db, {
    organizationId,
    userId: user.id,
    sourceType: body.sourceType,
    ...(Object.prototype.hasOwnProperty.call(body, 'externalId') ? { externalId: body.externalId } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'title') ? { title: body.title } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sourceText') ? { sourceText: body.sourceText } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'metadata') ? { metadata: body.metadata } : {}),
    ...(ingestStatus !== undefined ? { ingestStatus } : {})
  })

  return record
})
