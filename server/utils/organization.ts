import type { H3Event } from 'h3'
import type { ActiveOrgExtras, OwnershipInfo } from '~~/shared/utils/organizationExtras'
import { and, asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import {
  computeNeedsUpgrade,
  computeUserOwnsMultipleOrgs
} from '~~/shared/utils/organizationExtras'
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
        eq(schema.organization.isAnonymous, true)
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

const parseMetadata = (value: string | null) => {
  if (!value)
    return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export interface FullOrganizationPayload {
  data: {
    id: string
    name: string
    slug: string
    logo: string | null
    createdAt: Date | null
    metadata: any
    stripeCustomerId: string | null
    referralCode: string | null
    members: Array<{
      id: string
      organizationId: string
      userId: string
      role: string
      createdAt: Date | null
      user: {
        id: string
        name: string
        email: string
        image: string | null
        isAnonymous: boolean | null
      }
    }>
    invitations: Array<{
      id: string
      organizationId: string
      email: string
      role: string | null
      status: string
      expiresAt: Date
      createdAt: Date
      inviterId: string
    }>
  }
}

export const fetchFullOrganizationForSSR = async (organizationId: string): Promise<FullOrganizationPayload | null> => {
  const db = getDB()
  const [organizationRecord] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  if (!organizationRecord)
    return null

  const members = await db
    .select({
      id: schema.member.id,
      organizationId: schema.member.organizationId,
      userId: schema.member.userId,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      user: {
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        isAnonymous: schema.user.isAnonymous
      }
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.member.createdAt))

  const invitations = await db
    .select({
      id: schema.invitation.id,
      organizationId: schema.invitation.organizationId,
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      createdAt: schema.invitation.createdAt,
      inviterId: schema.invitation.inviterId
    })
    .from(schema.invitation)
    .where(eq(schema.invitation.organizationId, organizationId))
    .orderBy(asc(schema.invitation.createdAt))

  return {
    data: {
      ...organizationRecord,
      metadata: parseMetadata(organizationRecord.metadata ?? null),
      members,
      invitations
    }
  }
}

export const fetchActiveOrgExtrasForUser = async (userId: string, organizationId: string): Promise<ActiveOrgExtras> => {
  const db = getDB()
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

  const subscriptions = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.referenceId, organizationId))

  const ownedMemberships = await db
    .select({
      organizationId: schema.member.organizationId,
      createdAt: schema.organization.createdAt
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(
      eq(schema.member.userId, userId),
      eq(schema.member.role, 'owner')
    ))
    .orderBy(asc(schema.organization.createdAt))

  const ownershipInfo: OwnershipInfo = {
    ownedCount: ownedMemberships.length,
    firstOwnedOrgId: ownedMemberships[0]?.organizationId ?? null
  }

  return {
    subscriptions,
    needsUpgrade: computeNeedsUpgrade(organizationId, subscriptions, ownershipInfo),
    userOwnsMultipleOrgs: computeUserOwnsMultipleOrgs(ownershipInfo)
  }
}
