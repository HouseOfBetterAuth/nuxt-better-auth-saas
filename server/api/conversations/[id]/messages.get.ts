import { and, eq, sql } from 'drizzle-orm'
import { createError, getQuery, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { createPaginatedResponse } from '~~/server/utils/responses'
import { validateNumber, validateUUID } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const conversationId = validateUUID(id, 'id')

  const conversation = await getConversationById(db, conversationId, organizationId)

  if (!conversation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Conversation not found'
    })
  }

  const query = getQuery(event)

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
    const parsedPage = Number.parseInt(pageRaw, 10)
    if (!Number.isFinite(parsedPage)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid page parameter'
      })
    }
    const page = validateNumber(parsedPage, 'page', 1)
    offset = (page - 1) * limit
  } else {
    const offsetRaw = getQueryValue(query.offset as string | string[] | undefined)
    const parsedOffset = Number.parseInt(offsetRaw ?? '0', 10)
    offset = validateNumber(parsedOffset, 'offset', 0)
  }

  const rows = await db
    .select({
      id: schema.conversationMessage.id,
      role: schema.conversationMessage.role,
      content: schema.conversationMessage.content,
      payload: schema.conversationMessage.payload,
      createdAt: schema.conversationMessage.createdAt,
      totalCount: sql<number>`COUNT(*) OVER()`.as('total_count')
    })
    .from(schema.conversationMessage)
    .where(and(
      eq(schema.conversationMessage.conversationId, conversationId),
      eq(schema.conversationMessage.organizationId, organizationId)
    ))
    .orderBy(schema.conversationMessage.createdAt)
    .limit(limit)
    .offset(offset)

  const total = rows.length > 0 ? Number(rows[0].totalCount ?? 0) : 0

  const mappedMessages = rows.map(row => ({
    id: row.id,
    role: row.role,
    content: row.content,
    payload: row.payload,
    createdAt: row.createdAt
  }))

  return createPaginatedResponse(mappedMessages, total, limit, offset)
})
