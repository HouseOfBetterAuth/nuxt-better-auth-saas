import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')

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
      statusMessage: 'Draft not found'
    })
  }

  if (content.status === 'archived') {
    return { success: true, status: 'archived' }
  }

  await db
    .update(schema.content)
    .set({ status: 'archived' })
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId)
    ))

  return { success: true, status: 'archived' }
})
