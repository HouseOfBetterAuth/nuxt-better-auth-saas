import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { getAuthSession } from './auth'
import { getDB } from './db'

interface BetterAuthSession {
  session?: {
    activeOrganizationId?: string
  }
  data?: {
    session?: {
      activeOrganizationId?: string
    }
  }
  activeOrganizationId?: string
}

interface RequireActiveOrganizationOptions {
  requireRoles?: Array<'owner' | 'admin' | 'member'>
  /**
   * Indicates the current user is anonymous so we can surface a friendlier error.
   * This does not bypass the organization requirement.
   */
  isAnonymousUser?: boolean
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

  // Get active organization from Better Auth session
  const session = await getAuthSession(event) as BetterAuthSession | null

  // Better Auth's organization plugin sets activeOrganizationId in the session
  const organizationId = session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId

  if (!organizationId) {
    // For anonymous users, provide a more helpful error message
    if (options?.isAnonymousUser) {
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

  // Verify organization exists first (handles stale organizationId from deleted orgs)
  const [orgExists] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  if (!orgExists) {
    // Organization doesn't exist (was deleted), treat as no organization
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
