import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const { id } = getRouterParams(event)

  if (!id || typeof id !== 'string' || !id.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid source content id is required'
    })
  }

  const [record] = await db
    .select()
    .from(schema.sourceContent)
    .where(and(
      eq(schema.sourceContent.id, id),
      eq(schema.sourceContent.organizationId, organizationId)
    ))
    .limit(1)

  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Source content not found'
    })
  }

  return record
})
