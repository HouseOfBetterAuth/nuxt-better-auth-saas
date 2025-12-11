import { and, count, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { createPaginatedResponse } from '~~/server/utils/responses'
import { validateNumber } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const sourceType = typeof query.sourceType === 'string' ? query.sourceType : undefined
  const ingestStatusRaw = typeof query.ingestStatus === 'string' ? query.ingestStatus : undefined
  type IngestStatus = (typeof schema.ingestStatusEnum)['enumValues'][number]
  const ingestStatus = ingestStatusRaw && (schema.ingestStatusEnum.enumValues as readonly string[]).includes(ingestStatusRaw)
    ? ingestStatusRaw as IngestStatus
    : undefined

  const whereClauses = [
    eq(schema.sourceContent.organizationId, organizationId)
  ]

  if (sourceType) {
    whereClauses.push(eq(schema.sourceContent.sourceType, sourceType))
  }

  if (ingestStatus) {
    whereClauses.push(eq(schema.sourceContent.ingestStatus, ingestStatus))
  }

  const whereClause = whereClauses.length > 1 ? (and(...whereClauses) ?? whereClauses[0]) : whereClauses[0]

  const getQueryValue = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
      return value[0]
    }
    return value
  }

  const perPageRaw = getQueryValue(query.perPage as string | string[] | undefined)
  const limitRaw = perPageRaw ?? getQueryValue(query.limit as string | string[] | undefined)
  let limit = Number.parseInt(limitRaw ?? '', 10)
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = DEFAULT_LIMIT
  }
  limit = Math.min(limit, MAX_LIMIT)

  const pageRaw = getQueryValue(query.page as string | string[] | undefined)
  let offset: number

  if (pageRaw) {
    const page = validateNumber(Number.parseInt(pageRaw, 10), 'page', 1)
    offset = (page - 1) * limit
  } else {
    const offsetRaw = getQueryValue(query.offset as string | string[] | undefined)
    const parsedOffset = Number.parseInt(offsetRaw ?? '0', 10)
    offset = validateNumber(parsedOffset, 'offset', 0)
  }

  const rows = await db.select()
    .from(schema.sourceContent)
    .where(whereClause)
    .orderBy(desc(schema.sourceContent.updatedAt))
    .limit(limit)
    .offset(offset)

  const totalResult = await db
    .select({ value: count() })
    .from(schema.sourceContent)
    .where(whereClause)

  const total = Number(totalResult[0]?.value ?? 0)

  return createPaginatedResponse(rows, total, limit, offset)
})
