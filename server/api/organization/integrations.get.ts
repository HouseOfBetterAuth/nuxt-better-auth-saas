import type { GithubIntegrationProvider } from '~~/shared/constants/githubScopes'
import type { GoogleIntegrationProvider } from '~~/shared/constants/googleScopes'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { GITHUB_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/googleScopes'

function parseScopes(scope: string | null | undefined): string[] {
  return scope?.split(' ').map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []
}

function hasGoogleIntegrationScopes(scope: string | null | undefined, provider: GoogleIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  const requiredScopes = GOOGLE_INTEGRATION_MATCH_SCOPES[provider]
  return requiredScopes.every(required => parsedScopes.includes(required))
}

function hasGithubIntegrationScopes(scope: string | null | undefined, provider: GithubIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  const requiredScopes = GITHUB_INTEGRATION_MATCH_SCOPES[provider]
  return requiredScopes.every(required => parsedScopes.includes(required))
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

  // Find Google accounts that have granted integration scopes for these users
  const googleAccounts = await db.select().from(schema.account).where(and(
    inArray(schema.account.userId, userIds),
    eq(schema.account.providerId, 'google')
  ))

  // Find GitHub accounts for these users
  const githubAccounts = await db.select().from(schema.account).where(and(
    inArray(schema.account.userId, userIds),
    eq(schema.account.providerId, 'github')
  ))

  // Filter by scopes and transform to integration format
  const now = new Date()

  const googleIntegrations = googleAccounts.flatMap((acc) => {
    const matchingProviders = (Object.keys(GOOGLE_INTEGRATION_MATCH_SCOPES) as GoogleIntegrationProvider[])
      .filter(provider => hasGoogleIntegrationScopes(acc.scope, provider))

    return matchingProviders.map(provider => ({
      id: acc.id,
      provider,
      type: 'oauth',
      status: !acc.accessTokenExpiresAt || new Date(acc.accessTokenExpiresAt) > now ? 'connected' : 'expired',
      accessToken: acc.accessToken,
      refreshToken: acc.refreshToken,
      expiresAt: acc.accessTokenExpiresAt,
      scopes: acc.scope,
      connectedByUserId: acc.userId,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt
    }))
  })

  const githubIntegrations = githubAccounts.flatMap((acc) => {
    const matchingProviders = (Object.keys(GITHUB_INTEGRATION_MATCH_SCOPES) as GithubIntegrationProvider[])
      .filter(provider => hasGithubIntegrationScopes(acc.scope, provider))

    return matchingProviders.map(provider => ({
      id: acc.id,
      provider,
      type: 'oauth',
      status: !acc.accessTokenExpiresAt || new Date(acc.accessTokenExpiresAt) > now ? 'connected' : 'expired',
      accessToken: acc.accessToken,
      refreshToken: acc.refreshToken,
      expiresAt: acc.accessTokenExpiresAt,
      scopes: acc.scope,
      connectedByUserId: acc.userId,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt
    }))
  })

  return [...googleIntegrations, ...githubIntegrations]
})
