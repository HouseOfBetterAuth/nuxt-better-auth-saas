import { getRouterParams } from 'h3'
import { getContentWorkspacePayload } from '~~/server/services/content/workspace'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

/**
 * Gets content workspace payload by ID
 *
 * @description Returns the complete workspace data for a content item including versions and sections
 *
 * @param id - Content ID (from route)
 * @returns Content workspace payload with all versions and metadata
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const validatedId = validateUUID(id, 'id')

  return await getContentWorkspacePayload(db, organizationId, validatedId)
})
