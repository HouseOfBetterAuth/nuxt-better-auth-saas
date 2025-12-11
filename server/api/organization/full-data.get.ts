/**
 * Server-side only endpoint that fetches ALL organization data
 * Queries database directly - NO HTTP calls, NO Better Auth API calls
 */

import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  try {
    const db = await useDB()

    const user = await requireAuth(event, { allowAnonymous: true })
    const { organizationId: activeOrgId } = await requireActiveOrganization(event, user.id, {
      isAnonymousUser: Boolean((user as any)?.isAnonymous)
    })

    // Fetch organization with all relations in a single database query
    const org = await db.query.organization.findFirst({
      where: eq(organizationTable.id, activeOrgId),
      with: {
        members: {
          with: {
            user: true
          }
        },
        invitations: true
      }
    })

    // If organization doesn't exist (e.g., was deleted), return null org
    // Better Auth will handle clearing the stale activeOrganizationId
    if (!org) {
      return {
        organization: null,
        subscriptions: [],
        needsUpgrade: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      }
    }

    // Verify that the current user is a member of this organization
    const isMember = org.members.some((m: any) => m.userId === user.id)
    if (!isMember) {
      console.warn(`User ${session.user.id} attempted to access org ${activeOrgId} without membership`)
      throw createError({
        statusCode: 403,
        message: 'You are not a member of this organization'
      })
    }

    // Fetch subscriptions for this organization
    const subscriptions = await db.query.subscription.findMany({
      where: eq(subscriptionTable.referenceId, activeOrgId)
    })

    // Calculate needsUpgrade Server-Side
    // 1. Get all organizations owned by this user
    const ownedMemberships = await db.query.member.findMany({
      where: and(
        eq(memberTable.userId, user.id),
        eq(memberTable.role, 'owner')
      ),
      with: {
        organization: true
      }
    })

    // 2. Sort by creation date to find the "First (Free)" org
    const sortedOrgs = ownedMemberships
      .map(m => m.organization)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const firstOrgId = sortedOrgs[0]?.id

    // If I am NOT the owner of the current org, I assume the Owner handles billing.
    // But if the org is locked, members should also see the locked state.
    // The logic relies on whether this org *itself* is the "Free One" of its *Owner*?
    // Actually, simpler: If this org is NOT the user's first owned org, it needs a sub.
    // BUT wait, if I am just a MEMBER, I don't own it. Does it count against MY limit? No.
    // It counts against the OWNER'S limit.
    // However, implementing "Check Owner's other orgs" is complex here.
    // Simplified Rule: If *current user* is Owner, enforce logic.
    // If current user is Member, we might trust `org.stripeCustomerId` presence?
    // Let's stick to: If I am Owner -> Check my orgs.
    // If I am Member -> Check if Subscription is Active (if it exists).
    // If no subscription exists and I am member, assume it's the Owner's free org?

    // To be robust: We should check the OWNER of this org.
    const ownerMember = org.members.find(m => m.role === 'owner')
    let isFreeOrg = false

    if (ownerMember) {
      // If I am the owner, I already fetched my orgs.
      if (ownerMember.userId === user.id) {
        isFreeOrg = activeOrgId === firstOrgId
      } else {
        // I am not the owner. I need to check the OWNER's orgs to see if this is THEIR first org.
        // This requires fetching the Owner's memberships.
        const ownerMemberships = await db.query.member.findMany({
          where: and(
            eq(memberTable.userId, ownerMember.userId),
            eq(memberTable.role, 'owner')
          ),
          with: {
            organization: true
          }
        })
        const ownerSortedOrgs = ownerMemberships
          .map(m => m.organization)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        isFreeOrg = activeOrgId === ownerSortedOrgs[0]?.id
      }
    }

    const hasActiveSub = subscriptions.some(s => s.status === 'active' || s.status === 'trialing')
    const needsUpgrade = !isFreeOrg && !hasActiveSub

    const userOwnsMultipleOrgs = ownedMemberships.length > 1

    if (process.env.NODE_ENV === 'development') {
      console.log('[API] Full Data - Org:', activeOrgId, 'Subs:', subscriptions.length, 'NeedsUpgrade:', needsUpgrade, 'UserOwnsMultipleOrgs:', userOwnsMultipleOrgs)
    }

    return {
      organization: org,
      subscriptions: subscriptions || [],
      needsUpgrade,
      userOwnsMultipleOrgs,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    }
  } catch (error: any) {
    console.error('Error fetching full organization data:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || 'Failed to fetch organization data'
    })
  }
})
