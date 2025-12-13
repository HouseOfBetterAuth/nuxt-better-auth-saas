import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'

const paramsSchema = z.object({
  orgId: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const { orgId } = await getValidatedRouterParams(event, paramsSchema.parse)
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

  const conversations = await db
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
      eq(schema.conversation.organizationId, orgId)
    ))
    .orderBy(desc(schema.conversation.updatedAt))
    .limit(200)

  return { org, conversations }
})
