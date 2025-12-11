import type { GithubIntegrationProvider } from '~~/shared/constants/githubScopes'
import type { GoogleIntegrationProvider } from '~~/shared/constants/googleScopes'
import { Buffer } from 'node:buffer'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { member } from '~~/server/db/schema'
import * as schema from '~~/server/db/schema'
import { requireAuth, useServerAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { GITHUB_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_MATCH_SCOPES } from '~~/shared/constants/googleScopes'

const GOOGLE_INTEGRATION_PROVIDERS = Object.keys(GOOGLE_INTEGRATION_MATCH_SCOPES) as GoogleIntegrationProvider[]
const GITHUB_INTEGRATION_PROVIDERS = Object.keys(GITHUB_INTEGRATION_MATCH_SCOPES) as GithubIntegrationProvider[]

const isGoogleIntegrationProvider = (provider: string): provider is GoogleIntegrationProvider =>
  GOOGLE_INTEGRATION_PROVIDERS.includes(provider as GoogleIntegrationProvider)
const isGithubIntegrationProvider = (provider: string): provider is GithubIntegrationProvider =>
  GITHUB_INTEGRATION_PROVIDERS.includes(provider as GithubIntegrationProvider)

function parseScopes(scope: string | null | undefined): string[] {
  return scope?.split(/[, ]+/).map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []
}

function hasGoogleIntegrationScopes(scope: string | null | undefined, provider: GoogleIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  const requiredScopes = GOOGLE_INTEGRATION_MATCH_SCOPES[provider]
  return requiredScopes.every(required => parsedScopes.includes(required))
}

function hasOnlyGoogleIntegrationScopes(scope: string | null | undefined, provider: GoogleIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  if (parsedScopes.length === 0)
    return false
  const requiredScopes = new Set<string>(GOOGLE_INTEGRATION_MATCH_SCOPES[provider])
  const integrationScopes = parsedScopes.filter(scopeEntry => requiredScopes.has(scopeEntry))
  const nonIntegrationScopes = parsedScopes.filter(scopeEntry => !requiredScopes.has(scopeEntry))
  return integrationScopes.length > 0 && nonIntegrationScopes.length === 0
}

function removeGoogleIntegrationScopes(scope: string | null | undefined, provider: GoogleIntegrationProvider): string | null {
  const requiredScopes = new Set<string>(GOOGLE_INTEGRATION_MATCH_SCOPES[provider])
  const parsedScopes = parseScopes(scope)
  const filteredScopes = parsedScopes.filter(scopeEntry => !requiredScopes.has(scopeEntry))
  return filteredScopes.length ? filteredScopes.join(' ') : null
}

function hasGithubIntegrationScopes(scope: string | null | undefined, provider: GithubIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  const requiredScopes = GITHUB_INTEGRATION_MATCH_SCOPES[provider]
  return requiredScopes.every(required => parsedScopes.includes(required))
}

function hasOnlyGithubIntegrationScopes(scope: string | null | undefined, provider: GithubIntegrationProvider): boolean {
  const parsedScopes = parseScopes(scope)
  if (parsedScopes.length === 0)
    return false
  const requiredScopes = new Set<string>(GITHUB_INTEGRATION_MATCH_SCOPES[provider])
  const integrationScopes = parsedScopes.filter(scopeEntry => requiredScopes.has(scopeEntry))
  const nonIntegrationScopes = parsedScopes.filter(scopeEntry => !requiredScopes.has(scopeEntry))
  return integrationScopes.length > 0 && nonIntegrationScopes.length === 0
}

function removeGithubIntegrationScopes(scope: string | null | undefined, provider: GithubIntegrationProvider): string | null {
  const requiredScopes = new Set<string>(GITHUB_INTEGRATION_MATCH_SCOPES[provider])
  const parsedScopes = parseScopes(scope)
  const filteredScopes = parsedScopes.filter(scopeEntry => !requiredScopes.has(scopeEntry))
  return filteredScopes.length ? filteredScopes.join(' ') : null
}

async function revokeGithubToken(token: string) {
  const clientId = runtimeConfig.githubClientId
  const clientSecret = runtimeConfig.githubClientSecret

  if (!clientId || !clientSecret) {
    console.warn('GitHub client credentials not configured - skipping token revocation')
    return
  }

  try {
    await $fetch(`https://api.github.com/applications/${clientId}/grant`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        Accept: 'application/vnd.github+json'
      },
      body: {
        access_token: token
      }
    })
  } catch (error: any) {
    console.warn('GitHub token revocation warning (non-fatal):', error?.message || 'Unknown error')
  }
}

// Soft disconnect: Revoke tokens without unlinking the account
async function softDisconnectGoogleIntegration(
  db: ReturnType<typeof getDB>,
  account: typeof schema.account.$inferSelect,
  provider: GoogleIntegrationProvider
) {
  // 1. Revoke tokens with Google's API
  if (account.accessToken) {
    try {
      await $fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          token: account.accessToken
        })
      })
    } catch (error: any) {
      // Google's revoke endpoint returns 200 even if token is invalid/expired
      // Log warning but continue - token revocation is best effort
      console.warn('Token revocation warning (non-fatal):', error?.message || 'Unknown error')
    }
  }

  // 2. Remove integration-specific scopes from the account
  const updatedScopes = removeGoogleIntegrationScopes(account.scope, provider)

  // 3. Update account record: clear tokens and remove YouTube scopes
  // Keep account linked for sign-in purposes
  await db.update(schema.account)
    .set({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: updatedScopes,
      updatedAt: new Date()
    })
    .where(eq(schema.account.id, account.id))
}

async function softDisconnectGithubIntegration(
  db: ReturnType<typeof getDB>,
  account: typeof schema.account.$inferSelect,
  provider: GithubIntegrationProvider
) {
  if (account.accessToken) {
    await revokeGithubToken(account.accessToken)
  }

  const updatedScopes = removeGithubIntegrationScopes(account.scope, provider)

  await db.update(schema.account)
    .set({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: updatedScopes,
      updatedAt: new Date()
    })
    .where(eq(schema.account.id, account.id))
}

// Hard unlink: Completely remove the account from Better Auth
async function hardUnlinkAccount(
  auth: ReturnType<typeof useServerAuth>,
  eventHeaders: Headers,
  accounts: Array<typeof schema.account.$inferSelect>,
  targetAccount: typeof schema.account.$inferSelect,
  providerId: string
) {
  try {
    const unlinkBody = accounts.length === 1
      ? { providerId }
      : { providerId, accountId: targetAccount.accountId }

    await auth.api.unlinkAccount({
      body: unlinkBody,
      headers: eventHeaders
    })
  } catch (error: any) {
    // Fallback: manually delete if Better Auth API fails
    // Use Better Auth's status field for reliable error detection
    const isNotFound = error instanceof APIError
      ? error.status === 'NOT_FOUND' || error.statusCode === 404
      : error?.statusCode === 404 || error?.status === 'NOT_FOUND'

    if (isNotFound) {
      const db = getDB()
      await db.delete(schema.account).where(eq(schema.account.id, targetAccount.id))
    } else {
      throw error
    }
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = getQuery(event)
  const organizationId = query.organizationId as string
  const provider = query.provider as string

  if (!organizationId || !provider) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Organization ID and Provider are required'
    })
  }

  const db = getDB()

  // Check if user is admin/owner of this org
  const membership = await db.select().from(member).where(and(
    eq(member.userId, user.id),
    eq(member.organizationId, organizationId)
  )).limit(1)

  const membershipRecord = membership[0]
  if (!membershipRecord || (membershipRecord.role !== 'owner' && membershipRecord.role !== 'admin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to manage integrations for this organization'
    })
  }

  const auth = useServerAuth()

  // For Google-based integrations, accounts are stored as 'google' provider with the requested scopes
  if (isGoogleIntegrationProvider(provider)) {
    // Find all Google accounts for the current user
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, 'google')
    ))

    // Find the account with desired scopes
    const integrationAccount = accounts.find(acc => hasGoogleIntegrationScopes(acc.scope, provider))

    if (!integrationAccount) {
      throw createError({
        statusCode: 404,
        statusMessage: `Integration not found for provider: ${provider}`
      })
    }

    // Determine disconnect strategy based on scope composition
    const accountHasOnlyRequestedScopes = hasOnlyGoogleIntegrationScopes(integrationAccount.scope, provider)

    // Strategy:
    // - Hard unlink: ONLY if account has integration scopes and NO other scopes
    //   (Safe to remove completely - no sign-in impact)
    // - Soft disconnect: If account also has other scopes (email, profile, etc.)
    //   (Preserve sign-in by keeping account linked, just revoke feature tokens)

    if (accountHasOnlyRequestedScopes) {
      // Safe to hard unlink - account has ONLY the requested scopes
      // No sign-in impact since there are no email/profile scopes
      await hardUnlinkAccount(auth, event.headers, accounts, integrationAccount, 'google')
    } else {
      // Use soft disconnect - account has integration + other scopes
      // Preserve sign-in by keeping account linked, just revoke feature tokens
      await softDisconnectGoogleIntegration(db, integrationAccount, provider)
    }

    return { success: true }
  } else if (isGithubIntegrationProvider(provider)) {
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, 'github')
    ))

    const integrationAccount = accounts.find(acc => hasGithubIntegrationScopes(acc.scope, provider))

    if (!integrationAccount) {
      throw createError({
        statusCode: 404,
        statusMessage: `Integration not found for provider: ${provider}`
      })
    }

    const accountHasOnlyRequestedScopes = hasOnlyGithubIntegrationScopes(integrationAccount.scope, provider)

    if (accountHasOnlyRequestedScopes) {
      await hardUnlinkAccount(auth, event.headers, accounts, integrationAccount, 'github')
    } else {
      await softDisconnectGithubIntegration(db, integrationAccount, provider)
    }

    return { success: true }
  } else {
    // For other providers, use the provider directly
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, provider)
    )).limit(1)

    if (accounts.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: `Integration not found for provider: ${provider}`
      })
    }

    // Try to unlink using Better Auth's API
    // If that fails, manually delete from database as fallback
    try {
      const [accountRecord] = accounts
      if (!accountRecord) {
        throw createError({
          statusCode: 404,
          statusMessage: `Integration not found for provider: ${provider}`
        })
      }
      await auth.api.unlinkAccount({
        body: {
          providerId: provider,
          accountId: accountRecord.accountId
        },
        headers: event.headers
      })
    } catch (error: any) {
      // Fallback: manually delete if Better Auth API fails
      // Use Better Auth's status field for reliable error detection
      const isNotFound = error instanceof APIError
        ? error.status === 'NOT_FOUND' || error.statusCode === 404
        : error?.statusCode === 404 || error?.status === 'NOT_FOUND'

      if (isNotFound) {
        const [accountRecord] = accounts
        if (accountRecord) {
          await db.delete(schema.account).where(eq(schema.account.id, accountRecord.id))
        }
      } else {
        throw error
      }
    }
    return { success: true }
  }
})
