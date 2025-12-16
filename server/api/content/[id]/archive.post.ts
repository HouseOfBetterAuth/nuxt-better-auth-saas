import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { logAuditEvent } from '~~/server/utils/auditLogger'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')

  const now = new Date()

  const [updatedContent] = await db
    .update(schema.content)
    .set({
      status: 'archived',
      archivedAt: now,
      updatedAt: now
    })
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.status, 'draft')
    ))
    .returning()

  if (!updatedContent) {
    const [content] = await db
      .select({
        id: schema.content.id,
        status: schema.content.status
      })
      .from(schema.content)
      .where(and(
        eq(schema.content.id, contentId),
        eq(schema.content.organizationId, organizationId)
      ))
      .limit(1)

    if (!content) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found'
      })
    }

    if (content.status === 'archived') {
      return { success: true, status: 'archived' }
    }

    throw createError({
      statusCode: 400,
      statusMessage: 'Only content with draft status can be archived'
    })
  }

  await logAuditEvent({
    userId: user.id,
    category: 'content',
    action: 'archive',
    targetType: 'content',
    targetId: contentId,
    details: JSON.stringify({ organizationId })
  })

  return { success: true, status: 'archived' }
})
