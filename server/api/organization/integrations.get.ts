import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import * as schema from '~~/server/database/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  
  // Get organizationId from the session (active organization)
  // We fetch the user's last active organization from the DB which acts as the session context
  const db = getDB()
  const fullUser = await db.select().from(schema.user).where(eq(schema.user.id, user.id)).limit(1)
  
  const organizationId = fullUser[0]?.lastActiveOrganizationId

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No active organization found in session'
    })
  }

  // Check if user is member of this org
  const membership = await db.select().from(schema.member).where(and(
      eq(schema.member.userId, user.id),
      eq(schema.member.organizationId, organizationId)
  )).limit(1)

  if (membership.length === 0) {
     throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to view integrations for this organization'
    })
  }
  // Ideally restrict to admin/owner, but viewing might be fine for members? 
  // Keeping it strict for now to match authorize endpoint
  if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
      throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to view integrations for this organization'
    })
  }

  const integrations = await db.select().from(schema.integration).where(eq(schema.integration.organizationId, organizationId))
  
  return integrations
})

