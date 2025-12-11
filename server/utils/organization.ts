import type { H3Event } from 'h3'
import { and, asc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '../db/schema'
import { setUserActiveOrganization } from '../services/organization/provision'
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
  let organizationId = session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId

  // Anonymous users get an auto-provisioned org; fall back to it if not in session
  if (!organizationId && options?.isAnonymousUser) {
    const [anonymousOrg] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .innerJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
      .where(and(
        eq(schema.member.userId, userId),
        sql`${schema.organization.slug} LIKE 'anonymous-%'`
      ))
      .limit(1)

    if (anonymousOrg?.id) {
      organizationId = anonymousOrg.id
      try {
        await setUserActiveOrganization(userId, anonymousOrg.id)
      } catch (error) {
        console.error('[requireActiveOrganization] Failed to set active organization in session:', error)
      }
    }
  }

  if (!organizationId) {
    const [firstOrg] = await db
      .select({ id: schema.organization.id })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
      .where(eq(schema.member.userId, userId))
      .orderBy(asc(schema.organization.createdAt))
      .limit(1)

    if (firstOrg?.id) {
      organizationId = firstOrg.id
      try {
        await setUserActiveOrganization(userId, firstOrg.id)
      } catch (error) {
        console.error('[requireActiveOrganization] Failed to set active organization in session:', error)
      }
    }
  }

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
      statusMessage: 'Organization referenced by session not found',
      data: {
        organizationId,
        message: 'The organization referenced in your session no longer exists. It may have been deleted.'
      }
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
