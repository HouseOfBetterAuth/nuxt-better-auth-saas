import { createError, getRouterParams } from 'h3'
import { getConversationById, getConversationMessages } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

/**
 * Get messages for a conversation
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

  const messages = await getConversationMessages(db, conversationId, organizationId)

  return {
    messages: messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      payload: message.payload,
      createdAt: message.createdAt
    }))
  }
})
