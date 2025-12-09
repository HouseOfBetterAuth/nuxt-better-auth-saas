import { and, count, eq } from 'drizzle-orm'
import { createError, getQuery, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { getConversationById, getConversationMessages } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { createPaginatedResponse } from '~~/server/utils/responses'
import { validateNumber, validateUUID } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/**
 * Get messages for a conversation with pagination
 */
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
    const page = validateNumber(Number.parseInt(pageRaw, 10), 'page', 1)
    offset = (page - 1) * limit
  } else {
    const offsetRaw = getQueryValue(query.offset as string | string[] | undefined)
    const parsedOffset = Number.parseInt(offsetRaw ?? '0', 10)
    offset = validateNumber(parsedOffset, 'offset', 0)
  }

  const messages = await getConversationMessages(db, conversationId, organizationId, {
    limit,
    offset
  })

  // Get total count for pagination
  const totalResult = await db
    .select({ value: count() })
    .from(schema.conversationMessage)
    .where(and(
      eq(schema.conversationMessage.conversationId, conversationId),
      eq(schema.conversationMessage.organizationId, organizationId)
    ))

  const total = Number(totalResult[0]?.value ?? 0)

  const mappedMessages = messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    payload: message.payload,
    createdAt: message.createdAt
  }))

  return createPaginatedResponse(mappedMessages, total, limit, offset)
})
