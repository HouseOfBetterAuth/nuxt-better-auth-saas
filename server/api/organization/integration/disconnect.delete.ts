import { and, eq } from 'drizzle-orm'
import { member } from '~~/server/database/schema'
import * as schema from '~~/server/database/schema'
import { requireAuth, useServerAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

// Helper function to check if account has YouTube scopes
function hasYouTubeScopes(scope: string | null | undefined): boolean {
  return !!scope && (
    scope.includes('https://www.googleapis.com/auth/youtube') ||
    scope.includes('https://www.googleapis.com/auth/youtube.force-ssl')
  )
}

// Helper function to check if account has ONLY YouTube scopes (no email/profile scopes)
function hasOnlyYouTubeScopes(scope: string | null | undefined): boolean {
  if (!scope)
    return false

  const scopes = scope.split(' ').filter(s => s.trim())
  const youtubeScopes = scopes.filter(s =>
    s.includes('youtube') || s.includes('youtube.force-ssl')
  )
  const nonYouTubeScopes = scopes.filter(s =>
    !s.includes('youtube') && !s.includes('youtube.force-ssl')
  )

  // Has YouTube scopes AND no other scopes (or only YouTube-related ones)
  return youtubeScopes.length > 0 && nonYouTubeScopes.length === 0
}

// Soft disconnect: Revoke tokens without unlinking the account
async function softDisconnectYouTube(db: ReturnType<typeof getDB>, account: typeof schema.account.$inferSelect) {
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

  // 2. Remove YouTube scopes from the account
  const updatedScopes = account.scope
    ?.split(' ')
    .filter((scope) => {
      const trimmed = scope.trim()
      return trimmed && !trimmed.includes('youtube') && !trimmed.includes('youtube.force-ssl')
    })
    .join(' ') || null

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

// Hard unlink: Completely remove the account from Better Auth
async function hardUnlinkAccount(
  auth: ReturnType<typeof useServerAuth>,
  eventHeaders: Headers,
  accounts: Array<typeof schema.account.$inferSelect>,
  targetAccount: typeof schema.account.$inferSelect
) {
  try {
    const unlinkBody = accounts.length === 1
      ? { providerId: 'google' }
      : { providerId: 'google', accountId: targetAccount.accountId }

    await auth.api.unlinkAccount({
      body: unlinkBody,
      headers: eventHeaders
    })
  } catch (error: any) {
    // Fallback: manually delete if Better Auth API fails
    if (error?.statusCode === 404 || error?.message?.includes('not found')) {
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

  if (membership.length === 0 || (membership[0].role !== 'owner' && membership[0].role !== 'admin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to manage integrations for this organization'
    })
  }

  const auth = useServerAuth()

  // For YouTube integrations, accounts are stored as 'google' provider with YouTube scopes
  if (provider === 'youtube') {
    // Find all Google accounts for the current user
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, 'google')
    ))

    // Find the account with YouTube scopes
    const youtubeAccount = accounts.find(acc => hasYouTubeScopes(acc.scope))

    if (!youtubeAccount) {
      throw createError({
        statusCode: 404,
        statusMessage: 'YouTube integration not found'
      })
    }

    // Determine disconnect strategy based on scope composition
    const accountHasOnlyYouTubeScopes = hasOnlyYouTubeScopes(youtubeAccount.scope)
    const hasOtherGoogleAccounts = accounts.some(acc => acc.id !== youtubeAccount.id)

    // Use soft disconnect if:
    // - Account has other scopes (email, profile) that are needed for sign-in
    // - User has multiple Google accounts (can preserve one for sign-in)
    // Use hard unlink if:
    // - Account has ONLY YouTube scopes (safe to remove completely)
    // - User has other Google accounts (sign-in preserved elsewhere)

    if (accountHasOnlyYouTubeScopes || hasOtherGoogleAccounts) {
      // Safe to hard unlink - YouTube-only account or other accounts exist
      await hardUnlinkAccount(auth, event.headers, accounts, youtubeAccount)
    } else {
      // Use soft disconnect - preserve sign-in by keeping account linked
      // but revoke YouTube tokens and remove YouTube scopes
      await softDisconnectYouTube(db, youtubeAccount)
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
      await auth.api.unlinkAccount({
        body: {
          providerId: provider,
          accountId: accounts[0].accountId
        },
        headers: event.headers
      })
    } catch (error: any) {
      // Fallback: manually delete if Better Auth API fails
      if (error?.statusCode === 404 || error?.message?.includes('not found')) {
        await db.delete(schema.account).where(eq(schema.account.id, accounts[0].id))
      } else {
        throw error
      }
    }
    return { success: true }
  }
})
