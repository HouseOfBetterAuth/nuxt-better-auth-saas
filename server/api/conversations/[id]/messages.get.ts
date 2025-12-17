import { and, eq, sql } from 'drizzle-orm'
import { createError, getQuery, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById } from '~~/server/services/conversation'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createPaginatedResponse } from '~~/server/utils/responses'
import { validateNumber, validateUUID } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export default defineEventHandler(async (event) => {
  try {
    await requireAuth(event)
    const { organizationId } = await requireActiveOrganization(event)
    const db = await useDB(event)

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
      const parsedOffsetOrFallback = Number.isFinite(parsedOffset) ? parsedOffset : 0
      offset = validateNumber(parsedOffsetOrFallback, 'offset', 0)
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
  } catch (error) {
    console.error('[Conversations Messages API] Error:', error)
    if (error instanceof Error) {
      console.error('[Conversations Messages API] Error name:', error.name)
      console.error('[Conversations Messages API] Error message:', error.message)
      console.error('[Conversations Messages API] Error stack:', error.stack)
    } else {
      console.error('[Conversations Messages API] Error type:', typeof error)
      console.error('[Conversations Messages API] Error value:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    }
    // Re-throw H3 errors as-is, wrap others
    if (error && typeof error === 'object' && 'statusCode' in error) {
      console.error('[Conversations Messages API] Re-throwing H3 error with statusCode:', (error as any).statusCode)
      throw error
    }
    console.error('[Conversations Messages API] Wrapping error in createError')
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
