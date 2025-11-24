import { and, count, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const sourceType = typeof query.sourceType === 'string' ? query.sourceType : undefined
  const ingestStatus = typeof query.ingestStatus === 'string' ? query.ingestStatus : undefined

  let whereClause = eq(schema.sourceContent.organizationId, organizationId)

  if (sourceType) {
    whereClause = and(whereClause, eq(schema.sourceContent.sourceType, sourceType))
  }

  if (ingestStatus) {
    whereClause = and(whereClause, eq(schema.sourceContent.ingestStatus, ingestStatus))
  }

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
    const page = Number.parseInt(pageRaw, 10)
    if (!Number.isFinite(page) || page < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'page must be a positive integer'
      })
    }
    offset = (page - 1) * limit
  } else {
    const offsetRaw = getQueryValue(query.offset as string | string[] | undefined)
    const parsedOffset = Number.parseInt(offsetRaw ?? '0', 10)
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      offset = 0
    } else {
      offset = parsedOffset
    }
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
  const hasMore = offset + rows.length < total
  const nextOffset = hasMore ? offset + limit : null

  return {
    data: rows,
    pagination: {
      limit,
      offset,
      total,
      hasMore,
      nextOffset
    }
  }
})
