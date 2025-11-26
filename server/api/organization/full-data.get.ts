/**
 * Server-side only endpoint that fetches ALL organization data
 * Queries database directly - NO HTTP calls, NO Better Auth API calls
 */

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { organization as organizationTable, subscription as subscriptionTable } from '../../database/schema'
import { getAuthSession } from '../../utils/auth'
import { useDB } from '../../utils/db'

const anonymizeId = (value?: string | null) => {
  if (!value)
    return 'unknown'
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

const sanitizeError = (error: any) => {
  const statusCode = error?.statusCode
  const code = error?.code
  const safeMessage = statusCode
    ? `Error ${statusCode}${code ? ` (${code})` : ''}`
    : 'Internal error'

  return {
    message: safeMessage,
    statusCode,
    code
  }
}

export default defineEventHandler(async (event) => {
  try {
    const db = await useDB()

    // Use Better Auth's official session retrieval
    // This handles cookie parsing, signature verification, and caching automatically
    const session = await getAuthSession(event)

    if (!session || !session.user) {
      throw createError({
        statusCode: 401,
        message: 'Invalid session'
      })
    }

    const activeOrgId = session.session.activeOrganizationId

    if (!activeOrgId) {
      console.warn('[Organization full-data] Missing active organization in session')
      throw createError({
        statusCode: 400,
        message: 'No active organization'
      })
    }

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

    if (!org) {
      throw createError({
        statusCode: 404,
        message: 'Organization not found'
      })
    }

    // Verify that the current user is a member of this organization
    const isMember = org.members.some(m => m.userId === session.user.id)
    if (!isMember) {
      console.warn('[Organization full-data] Membership check failed', {
        user: anonymizeId(session.user.id),
        organization: anonymizeId(activeOrgId)
      })
      throw createError({
        statusCode: 403,
        message: 'You are not a member of this organization'
      })
    }

    // Fetch subscriptions for this organization
    const subscriptions = await db.query.subscription.findMany({
      where: eq(subscriptionTable.referenceId, activeOrgId)
    })

    const sanitizedMembers = org.members.map((member) => {
      const { user, ...memberData } = member
      return {
        ...memberData,
        user: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email
            }
          : null
      }
    })

    const sanitizedInvitations = org.invitations.map((invitation: any) => {
      const { token, secret, ...safeInvitation } = invitation
      return safeInvitation
    })

    const sanitizedOrg = {
      ...org,
      members: sanitizedMembers,
      invitations: sanitizedInvitations
    }

    console.log('[Organization full-data] Returning organization payload', {
      organization: anonymizeId(activeOrgId),
      subscriptions: subscriptions.length
    })

    return {
      organization: sanitizedOrg,
      subscriptions,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name
      }
    }
  } catch (error: any) {
    const sanitized = sanitizeError(error)
    console.error('[Organization full-data] Error:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: sanitized.statusCode ? 'Failed to fetch organization data' : 'Internal server error'
    })
  }
})
