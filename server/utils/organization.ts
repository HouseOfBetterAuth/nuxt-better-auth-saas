import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { getAuthSession } from './auth'
import { getDB } from './db'

interface RequireActiveOrganizationOptions {
  requireRoles?: Array<'owner' | 'admin' | 'member'>
  allowAnonymous?: boolean
}

/**
 * Get the active organization from Better Auth session data.
 * This uses Better Auth's session hooks which inject activeOrganizationId into the session.
 * 
 * @param event - H3 event
 * @param userId - User ID (for verification, but we get orgId from session)
 * @param options - Options including role requirements and anonymous user handling
 * @returns Organization ID and membership details
 */
export const requireActiveOrganization = async (
  event: H3Event,
  userId: string,
  options?: RequireActiveOrganizationOptions
) => {
  const db = getDB()

  // Get active organization from Better Auth session (set by session.create.before hook)
  const session = await getAuthSession(event)
  
  // Try multiple paths to get activeOrganizationId from session
  let organizationId = (session?.session as any)?.activeOrganizationId 
    || (session?.data as any)?.session?.activeOrganizationId
    || (session as any)?.activeOrganizationId as string | undefined

  // Fallback: If session doesn't have it yet (e.g., just created anonymous session),
  // read from database. This happens when session was just created and cookies aren't
  // available in the same request yet.
  if (!organizationId) {
    const [dbUser] = await db
      .select({
        lastActiveOrganizationId: schema.user.lastActiveOrganizationId
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    organizationId = dbUser?.lastActiveOrganizationId || undefined
  }

  if (!organizationId) {
    // For anonymous users, provide a more helpful error message
    if (options?.allowAnonymous) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No active organization found. Anonymous users need an organization to continue. Please create an account or wait for organization creation to complete.'
      })
    }
    
    throw createError({
      statusCode: 400,
      statusMessage: 'No active organization found in session'
    })
  }

  // Verify membership using Better Auth's organization data
  // This ensures the user is actually a member of the organization
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(and(
      eq(schema.member.userId, userId),
      eq(schema.member.organizationId, organizationId)
    ))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have access to this organization'
    })
  }

  // Verify role requirements if specified
  if (options?.requireRoles && options.requireRoles.length > 0) {
    if (!options.requireRoles.includes(membership.role as any)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Insufficient permissions for this organization'
      })
    }
  }

  return { organizationId, membership }
}
