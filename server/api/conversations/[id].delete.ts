import { and, eq, ne } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { logAuditEvent } from '~~/server/utils/auditLogger'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const conversationId = validateUUID(id, 'id')

  const [conversation] = await db
    .select()
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId)
    ))
    .limit(1)

  if (!conversation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Conversation not found'
    })
  }

  const now = new Date()

  const [updatedConversation] = await db
    .update(schema.conversation)
    .set({
      status: 'archived',
      updatedAt: now
    })
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId),
      ne(schema.conversation.status, 'archived')
    ))
    .returning()

  const wasArchived = updatedConversation !== undefined

  await logAuditEvent({
    userId: user.id,
    category: 'conversation',
    action: 'archive',
    targetType: 'conversation',
    targetId: conversationId,
    details: JSON.stringify({
      organizationId,
      alreadyArchived: !wasArchived
    })
  })

  return { success: true, status: 'archived' }
})
