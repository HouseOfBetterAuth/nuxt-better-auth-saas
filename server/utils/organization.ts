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
import { getDB, useDB } from './db'
import { cacheClient } from './drivers'

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
  user?: {
    lastActiveOrganizationId?: string
  }
}

interface RequireActiveOrganizationOptions {
  requireRoles?: Array<'owner' | 'admin' | 'member'>
  /**
   * Indicates the current user is anonymous so we can surface a friendlier error.
   * This does not bypass the organization requirement.
   */
  isAnonymousUser?: boolean
}

const ACTIVE_ORG_CACHE_PREFIX = 'active-org:v1'
const ACTIVE_ORG_CACHE_TTL_SECONDS = 60
const ACTIVE_ORG_EVENT_CACHE_KEY = '__activeOrgCache'

interface ActiveOrgResult {
  organizationId: string
  membership: typeof schema.member.$inferSelect
}

type ActiveOrgContextValue = ActiveOrgResult & { userId: string }

const hasRequiredRole = (role: string, requiredRoles?: Array<'owner' | 'admin' | 'member'>) => {
  if (!requiredRoles || requiredRoles.length === 0) {
    return true
  }
  return requiredRoles.includes(role as any)
}

const buildActiveOrgCacheKey = (userId: string) => `${ACTIVE_ORG_CACHE_PREFIX}:${userId}`

const serializeMembership = (membership: typeof schema.member.$inferSelect) => ({
  ...membership,
  createdAt: membership.createdAt instanceof Date ? membership.createdAt.toISOString() : membership.createdAt
})

const deserializeMembership = (membership: ReturnType<typeof serializeMembership>): typeof schema.member.$inferSelect => ({
  ...membership,
  createdAt: membership.createdAt ? new Date(membership.createdAt) : new Date()
})

const getEventCachedActiveOrg = (
  event: H3Event | undefined,
  userId: string,
  organizationId?: string | null,
  requiredRoles?: Array<'owner' | 'admin' | 'member'>
): ActiveOrgResult | null => {
  if (!event)
    return null
  const cached = (event.context as Record<string, any>)[ACTIVE_ORG_EVENT_CACHE_KEY] as ActiveOrgContextValue | undefined
  if (!cached || cached.userId !== userId) {
    return null
  }
  if (organizationId && cached.organizationId !== organizationId) {
    return null
  }
  if (!hasRequiredRole(cached.membership.role, requiredRoles)) {
    return null
  }
  return { organizationId: cached.organizationId, membership: cached.membership }
}

const setEventCachedActiveOrg = (event: H3Event | undefined, userId: string, payload: ActiveOrgResult) => {
  if (!event)
    return
  (event.context as Record<string, any>)[ACTIVE_ORG_EVENT_CACHE_KEY] = {
    userId,
    ...payload
  }
}

const getCachedActiveOrg = async (userId: string): Promise<ActiveOrgResult | null> => {
  try {
    const key = buildActiveOrgCacheKey(userId)
    const raw = await cacheClient.get(key)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as { organizationId?: string, membership?: ReturnType<typeof serializeMembership> }
    if (!parsed.organizationId || !parsed.membership) {
      return null
    }
    return {
      organizationId: parsed.organizationId,
      membership: deserializeMembership(parsed.membership)
    }
  } catch (error) {
    console.error('[requireActiveOrganization] Failed to read cache', error)
    return null
  }
}

const cacheActiveOrg = async (userId: string, payload: ActiveOrgResult) => {
  try {
    const key = buildActiveOrgCacheKey(userId)
    await cacheClient.set(key, JSON.stringify({
      organizationId: payload.organizationId,
      membership: serializeMembership(payload.membership)
    }), ACTIVE_ORG_CACHE_TTL_SECONDS)
  } catch (error) {
    console.error('[requireActiveOrganization] Failed to cache organization lookup', error)
  }
}

const clearCachedActiveOrg = async (userId: string) => {
  try {
    await cacheClient.delete(buildActiveOrgCacheKey(userId))
  } catch (error) {
    console.error('[requireActiveOrganization] Failed to clear cached organization', error)
  }
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
  const db = await useDB(event)

  // Get active organization from Better Auth session
  const session = await getAuthSession(event) as BetterAuthSession | null

  // Better Auth's organization plugin sets activeOrganizationId in the session
  const sessionOrganizationId = session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId
  const hadSessionOrganization = Boolean(sessionOrganizationId)
  let organizationId = sessionOrganizationId
  let membershipFromLookup: typeof schema.member.$inferSelect | null = null
  const contextUser = event.context.user as { lastActiveOrganizationId?: string } | undefined
  const lastActiveFromUser = contextUser?.lastActiveOrganizationId
    ?? session?.user?.lastActiveOrganizationId
    ?? null

  const eventCached = getEventCachedActiveOrg(event, userId, organizationId, options?.requireRoles)
  if (eventCached) {
    return eventCached
  }

  const cachedResult = await getCachedActiveOrg(userId)
  if (cachedResult) {
    if (!organizationId) {
      organizationId = cachedResult.organizationId
    }

    if (organizationId === cachedResult.organizationId && hasRequiredRole(cachedResult.membership.role, options?.requireRoles)) {
      setEventCachedActiveOrg(event, userId, cachedResult)
      return cachedResult
    }
  }

  if (!organizationId && lastActiveFromUser) {
    organizationId = lastActiveFromUser
  }

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
    const [firstMembership] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .orderBy(asc(schema.member.createdAt))
      .limit(1)

    if (firstMembership?.organizationId) {
      organizationId = firstMembership.organizationId
      membershipFromLookup = firstMembership
      try {
        await setUserActiveOrganization(userId, firstMembership.organizationId)
      } catch (error) {
        console.error('[requireActiveOrganization] Failed to set active organization in session:', error)
      }
    }
  }

  if (!organizationId) {
    // For anonymous users, provide a more helpful error message
    if (options?.isAnonymousUser) {
      await clearCachedActiveOrg(userId)
      throw createError({
        statusCode: 400,
        statusMessage: 'No active organization found. Anonymous users need an organization to continue. Please create an account or wait for organization creation to complete.'
      })
    }

    await clearCachedActiveOrg(userId)
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
    await clearCachedActiveOrg(userId)
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
  let membership = membershipFromLookup
  if (!membership || membership.organizationId !== organizationId) {
    const [freshMembership] = await db
      .select()
      .from(schema.member)
      .where(and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      ))
      .limit(1)
    membership = freshMembership ?? null
  }

  if (!membership) {
    await clearCachedActiveOrg(userId)
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

  const result: ActiveOrgResult = { organizationId, membership }
  setEventCachedActiveOrg(event, userId, result)
  void cacheActiveOrg(userId, result)
  if (!hadSessionOrganization) {
    setUserActiveOrganization(userId, organizationId).catch((error) => {
      console.error('[requireActiveOrganization] Failed to persist active organization to session:', error)
    })
  }
  return result
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
