import type { GithubIntegrationProvider } from '~~/shared/constants/githubScopes'
import type { GoogleIntegrationProvider } from '~~/shared/constants/googleScopes'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { GITHUB_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/googleScopes'

function parseScopes(scope: string | null | undefined): string[] {
  return scope?.split(/[, ]+/).map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []
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

  // Get organizationId from Better Auth session
  const { organizationId } = await requireActiveOrganization(event, user.id, {
    requireRoles: ['owner', 'admin']
  })

  const db = getDB()

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
