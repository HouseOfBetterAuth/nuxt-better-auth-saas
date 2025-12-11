import { and, eq } from 'drizzle-orm'
import { getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createNotFoundError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

/**
 * Gets source content by ID
 *
 * @description Returns a single source content record by ID
 *
 * @param id - Source content ID (from route)
 * @returns Source content record
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const validatedId = validateUUID(id, 'id')

  const [record] = await db
    .select()
    .from(schema.sourceContent)
    .where(and(
      eq(schema.sourceContent.id, validatedId),
      eq(schema.sourceContent.organizationId, organizationId)
    ))
    .limit(1)

  if (!record) {
    throw createNotFoundError('Source content', validatedId)
  }

  return record
})
