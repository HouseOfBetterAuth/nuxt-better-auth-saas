/**
 * Catch-all handler for Better Auth's useActiveOrganization composable
 * that tries to fetch from this endpoint when organization data is not in session.
 *
 * This endpoint doesn't exist in Better Auth's organization plugin, but the
 * client-side composable may try to fetch from it. We check the session and
 * return the active organization if available, or null if not.
 */
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  try {
    const session = await getAuthSession(event)

    // Try to get activeOrganizationId from session (Better Auth's organization plugin sets this)
    const activeOrganizationId = (session as any)?.session?.activeOrganizationId
      ?? (session as any)?.data?.session?.activeOrganizationId
      ?? (session as any)?.activeOrganizationId

    if (!activeOrganizationId) {
      return null
    }

    // Fetch the organization data
    const db = getDB()
    const [organization] = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, activeOrganizationId))
      .limit(1)

    if (!organization) {
      return null
    }

    return {
      data: organization
    }
  }
  catch {
    // If there's any error, return null to prevent breaking the client
    return null
  }
})
