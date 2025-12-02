/**
 * Diagnostic endpoint to inspect account records in the database
 * Shows raw account data to help debug integration issues
 * NO CODE CHANGES - just gathering information
 */

import { and, eq, inArray } from 'drizzle-orm'
import { GOOGLE_INTEGRATION_MATCH_SCOPES } from '../../../shared/constants/googleScopes'
import * as schema from '../../database/schema'
import { requireAuth } from '../../utils/auth'
import { getDB } from '../../utils/db'

function parseScopes(scope: string | null | undefined): string[] {
  return scope?.split(' ').map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []
}

function hasGoogleIntegrationScopes(scope: string | null | undefined, provider: 'youtube' | 'google_drive'): boolean {
  const parsedScopes = parseScopes(scope)
  const requiredScopes = GOOGLE_INTEGRATION_MATCH_SCOPES[provider]
  return requiredScopes.every(required => parsedScopes.includes(required))
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

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
      statusMessage: 'You do not have permission to view this organization'
    })
  }

  if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to view diagnostics'
    })
  }

  // Get all members of this organization
  const orgMembers = await db.select().from(schema.member).where(eq(schema.member.organizationId, organizationId))
  const userIds = orgMembers.map(m => m.userId)

  // Get ALL Google accounts for org members (no filtering)
  const allGoogleAccounts = await db.select().from(schema.account).where(and(
    inArray(schema.account.userId, userIds),
    eq(schema.account.providerId, 'google')
  ))

  // Get ALL GitHub accounts for org members
  const allGithubAccounts = await db.select().from(schema.account).where(and(
    inArray(schema.account.userId, userIds),
    eq(schema.account.providerId, 'github')
  ))

  // Analyze each account
  const analyzedGoogleAccounts = allGoogleAccounts.map((acc) => {
    const scopes = parseScopes(acc.scope)
    const hasYouTube = hasGoogleIntegrationScopes(acc.scope, 'youtube')
    const hasGoogleDrive = hasGoogleIntegrationScopes(acc.scope, 'google_drive')

    // Check for required YouTube scopes individually
    const requiredYouTubeScopes = GOOGLE_INTEGRATION_MATCH_SCOPES.youtube
    const missingYouTubeScopes = requiredYouTubeScopes.filter(required => !scopes.includes(required))

    return {
      accountId: acc.id,
      userId: acc.userId,
      providerId: acc.providerId,
      accountIdField: acc.accountId,
      scope: acc.scope,
      scopesArray: scopes,
      scopeCount: scopes.length,
      hasYouTubeIntegration: hasYouTube,
      hasGoogleDriveIntegration: hasGoogleDrive,
      missingYouTubeScopes,
      hasAccessToken: !!acc.accessToken,
      hasRefreshToken: !!acc.refreshToken,
      accessTokenExpiresAt: acc.accessTokenExpiresAt,
      refreshTokenExpiresAt: acc.refreshTokenExpiresAt,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
      // Show first/last 10 chars of tokens for verification (not full tokens for security)
      accessTokenPreview: acc.accessToken ? `${acc.accessToken.substring(0, 10)}...${acc.accessToken.substring(acc.accessToken.length - 10)}` : null,
      refreshTokenPreview: acc.refreshToken ? `${acc.refreshToken.substring(0, 10)}...${acc.refreshToken.substring(acc.refreshToken.length - 10)}` : null
    }
  })

  const analyzedGithubAccounts = allGithubAccounts.map((acc) => {
    const scopes = parseScopes(acc.scope)
    return {
      accountId: acc.id,
      userId: acc.userId,
      providerId: acc.providerId,
      accountIdField: acc.accountId,
      scope: acc.scope,
      scopesArray: scopes,
      scopeCount: scopes.length,
      hasAccessToken: !!acc.accessToken,
      hasRefreshToken: !!acc.refreshToken,
      accessTokenExpiresAt: acc.accessTokenExpiresAt,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt
    }
  })

  // Get user info for each account
  const userInfo = await db.select({
    id: schema.user.id,
    email: schema.user.email,
    name: schema.user.name
  }).from(schema.user).where(inArray(schema.user.id, userIds))

  const userMap = new Map(userInfo.map(u => [u.id, u]))

  return {
    organizationId,
    currentUserId: user.id,
    orgMemberCount: orgMembers.length,
    summary: {
      totalGoogleAccounts: allGoogleAccounts.length,
      totalGithubAccounts: allGithubAccounts.length,
      googleAccountsWithYouTube: analyzedGoogleAccounts.filter(a => a.hasYouTubeIntegration).length,
      googleAccountsWithGoogleDrive: analyzedGoogleAccounts.filter(a => a.hasGoogleDriveIntegration).length
    },
    googleAccounts: analyzedGoogleAccounts.map(acc => ({
      ...acc,
      userEmail: userMap.get(acc.userId)?.email || 'Unknown',
      userName: userMap.get(acc.userId)?.name || 'Unknown'
    })),
    githubAccounts: analyzedGithubAccounts.map(acc => ({
      ...acc,
      userEmail: userMap.get(acc.userId)?.email || 'Unknown',
      userName: userMap.get(acc.userId)?.name || 'Unknown'
    })),
    requiredYouTubeScopes: GOOGLE_INTEGRATION_MATCH_SCOPES.youtube,
    requiredGoogleDriveScopes: GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive
  }
})
