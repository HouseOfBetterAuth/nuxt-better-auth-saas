import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'

const paramsSchema = z.object({
  orgId: z.string().min(1),
  conversationId: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const { orgId, conversationId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const db = await useDB(event)

  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)

  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Organization not found'
    })
  }

  const [conversation] = await db
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
      status: schema.conversation.status,
      sourceContentId: schema.conversation.sourceContentId,
      createdByUserId: schema.conversation.createdByUserId,
      metadata: schema.conversation.metadata,
      createdAt: schema.conversation.createdAt,
      updatedAt: schema.conversation.updatedAt
    })
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, orgId)
    ))
    .limit(1)

  if (!conversation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Conversation not found'
    })
  }

  const messages = await db
    .select({
      id: schema.conversationMessage.id,
      role: schema.conversationMessage.role,
      content: schema.conversationMessage.content,
      payload: schema.conversationMessage.payload,
      createdAt: schema.conversationMessage.createdAt
    })
    .from(schema.conversationMessage)
    .where(and(
      eq(schema.conversationMessage.conversationId, conversationId),
      eq(schema.conversationMessage.organizationId, orgId)
    ))
    .orderBy(asc(schema.conversationMessage.createdAt))
    .limit(500)

  const logs = await db
    .select({
      id: schema.conversationLog.id,
      type: schema.conversationLog.type,
      message: schema.conversationLog.message,
      payload: schema.conversationLog.payload,
      createdAt: schema.conversationLog.createdAt
    })
    .from(schema.conversationLog)
    .where(and(
      eq(schema.conversationLog.conversationId, conversationId),
      eq(schema.conversationLog.organizationId, orgId)
    ))
    .orderBy(desc(schema.conversationLog.createdAt))
    .limit(200)

  return { org, conversation, messages, logs }
})
