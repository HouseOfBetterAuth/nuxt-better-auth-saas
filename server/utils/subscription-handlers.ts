/**
 * Subscription lifecycle handlers
 * These functions are called by Better Auth Stripe webhooks
 */

import { member as memberTable } from '../db/schema'
import { useDB } from './db'

/**
 * Remove excess members when subscription expires or is canceled
 * Keeps only the owner, removes all other members
 */
export async function removeExcessMembersOnExpiration(organizationId: string) {
  try {
    const db = await useDB()

    // Get all members of the organization
    const members = await db.query.member.findMany({
      where: (member, { eq }) => eq(member.organizationId, organizationId),
      with: {
        user: true
      }
    })

    // Find the owner
    const owner = members.find(m => m.role === 'owner')

    if (!owner) {
      console.error(`No owner found for organization ${organizationId}`)
      return
    }

    // Get all non-owner members
    const membersToRemove = members.filter(m => m.role !== 'owner')

    if (membersToRemove.length === 0) {
      console.log(`No members to remove from organization ${organizationId}`)
      return
    }

    // Remove all non-owner members
    const { and, eq, ne } = await import('drizzle-orm')
    await db.delete(memberTable)
      .where(
        and(
          eq(memberTable.organizationId, organizationId),
          ne(memberTable.role, 'owner')
        )
      )

    console.log(`Removed ${membersToRemove.length} members from organization ${organizationId}`)

    // Optionally: Send notification emails to removed members
    for (const member of membersToRemove) {
      // TODO: Send email notification
      console.log(`Member ${member.user.email} removed from organization ${organizationId}`)
    }

    return {
      removedCount: membersToRemove.length,
      removedMembers: membersToRemove.map(m => ({
        email: m.user.email,
        role: m.role
      }))
    }
  } catch (error) {
    console.error('Error removing members on subscription expiration:', error)
    throw error
  }
}

/**
 * Check if subscription is expired or will expire soon
 */
export function isSubscriptionExpired(subscription: any): boolean {
  if (!subscription)
    return true

  const now = new Date()
  const periodEnd = new Date(subscription.periodEnd)

  return now > periodEnd && subscription.status !== 'active' && subscription.status !== 'trialing'
}

/**
 * Get days until subscription expires
 */
export function getDaysUntilExpiration(subscription: any): number {
  if (!subscription?.periodEnd)
    return 0

  const now = new Date()
  const periodEnd = new Date(subscription.periodEnd)
  const diffTime = periodEnd.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return Math.max(0, diffDays)
}
