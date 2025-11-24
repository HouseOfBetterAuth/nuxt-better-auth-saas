import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

// Helper function to check if account has YouTube scopes
function hasYouTubeScopes(scope: string | null | undefined): boolean {
  return !!scope && (
    scope.includes('https://www.googleapis.com/auth/youtube') ||
    scope.includes('https://www.googleapis.com/auth/youtube.force-ssl')
  )
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

  // Get organizationId from the session (active organization)
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

  if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to view integrations for this organization'
    })
  }

  // Get all members of this organization
  const orgMembers = await db.select().from(schema.member).where(eq(schema.member.organizationId, organizationId))

  if (orgMembers.length === 0) {
    return []
  }

  const userIds = orgMembers.map(m => m.userId)

  // Find Google accounts with YouTube scopes for these users
  const accounts = await db.select().from(schema.account).where(and(
    inArray(schema.account.userId, userIds),
    eq(schema.account.providerId, 'google')
  ))

  // Filter by YouTube scopes and transform to integration format
  const now = new Date()

  const integrations = accounts
    .filter(acc => hasYouTubeScopes(acc.scope))
    .map(acc => ({
      id: acc.id,
      provider: 'youtube', // Map Google provider to YouTube integration
      type: 'oauth',
      status: acc.accessTokenExpiresAt && new Date(acc.accessTokenExpiresAt) > now ? 'connected' : 'expired',
      accessToken: acc.accessToken,
      refreshToken: acc.refreshToken,
      expiresAt: acc.accessTokenExpiresAt,
      scopes: acc.scope,
      connectedByUserId: acc.userId,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt
    }))

  return integrations
})
