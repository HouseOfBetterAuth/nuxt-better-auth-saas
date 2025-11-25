import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid content id is required'
    })
  }

  const rows = await db
    .select({
      content: schema.content,
      sourceContent: schema.sourceContent,
      currentVersion: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, id)
    ))
    .limit(1)

  const record = rows[0]

  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  return record
})
