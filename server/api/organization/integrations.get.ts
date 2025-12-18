import { createError, getQuery } from 'h3'
import {
  assertIntegrationManager,
  getOrganizationIntegrationSyncMetadata,
  listOrganizationIntegrationsWithAccounts,
  syncOrganizationOAuthIntegrations,
  updateOrganizationIntegrationSyncMetadata
} from '~~/server/services/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

/**
 * GET /api/organization/integrations
 *
 * Returns the list of integrations for the active organization.
 *
 * Sync Behavior:
 * - By default this endpoint returns the latest cached integrations immediately.
 * - Use the `force_sync=true` query parameter to explicitly run the OAuth sync,
 *   no more than once per minute per organization. This should be done sparingly
 *   (e.g. right after a user links an account) because the sync performs heavier
 *   database work.
 *
 * Query Parameters:
 * - `force_sync` (optional): Set to "true" to force a sync. If omitted the
 *   endpoint simply returns cached integration records.
 *
 * Response Format:
 * {
 *   data: Integration[],           // Array of integration objects
 *   syncStatus: 'cached' | 'synced' | 'skipped' | 'error',  // Sync operation status
 *   lastSyncedAt: string | null    // ISO timestamp of last sync, or null if never synced
 * }
 *
 * Sync Status Values:
 * - 'cached': Cached data returned (a previous sync was completed)
 * - 'synced': Sync was performed for this request (force_sync=true)
 * - 'skipped': No sync has run yet for this org
 * - 'error': A forced sync was attempted but failed. Cached data was returned.
 *
 * Authentication:
 * - Requires authenticated user
 * - Requires active organization
 * - Requires organization owner or admin role
 */

const FORCE_SYNC_MIN_INTERVAL_MS = 60 * 1000

export async function handleGetIntegrations(
  event: any,
  options: {
    getQuery: (event: any) => any
    requireAuth: (event: any) => Promise<any>
    requireActiveOrganization: (event: any) => Promise<{ organizationId: string }>
    getDB: () => any
    assertIntegrationManager: (db: any, userId: string, organizationId: string) => Promise<void>
    getOrganizationIntegrationSyncMetadata: (db: any, organizationId: string) => Promise<Date | null>
    listOrganizationIntegrationsWithAccounts: (db: any, organizationId: string) => Promise<any[]>
    syncOrganizationOAuthIntegrations: (db: any, organizationId: string) => Promise<void>
    updateOrganizationIntegrationSyncMetadata: (db: any, organizationId: string, date: Date) => Promise<void>
    createError: (options: { statusCode: number, statusMessage: string, message: string }) => any
  }
) {
  const user = await options.requireAuth(event)
  const { organizationId } = await options.requireActiveOrganization(event)
  const db = options.getDB()

  await options.assertIntegrationManager(db, user.id, organizationId)

  const query = options.getQuery(event)
  const forceSync = query.force_sync === 'true' || query.force_sync === true
  const lastSyncedAt = await options.getOrganizationIntegrationSyncMetadata(db, organizationId)
  const lastSyncTime = lastSyncedAt?.getTime() ?? null

  let syncStatus: 'cached' | 'synced' | 'skipped' | 'error' = lastSyncTime ? 'cached' : 'skipped'
  let newLastSyncTime = lastSyncTime

  if (forceSync) {
    const now = Date.now()
    if (lastSyncTime && now - lastSyncTime < FORCE_SYNC_MIN_INTERVAL_MS) {
      throw options.createError({
        statusCode: 429,
        statusMessage: 'Too Many Requests',
        message: 'Integrations were just synced. Please wait a moment before forcing another sync.'
      })
    }

    try {
      await options.syncOrganizationOAuthIntegrations(db, organizationId)
      newLastSyncTime = now
      await options.updateOrganizationIntegrationSyncMetadata(db, organizationId, new Date(newLastSyncTime))
      syncStatus = 'synced'
    } catch (error) {
      console.error('[integrations] Sync failed', error)
      syncStatus = 'error'
    }
  }

  const integrations = await options.listOrganizationIntegrationsWithAccounts(db, organizationId)

  // Return data with sync status metadata
  // The 'data' field contains the integrations array for backward compatibility
  return {
    data: integrations,
    syncStatus,
    lastSyncedAt: newLastSyncTime ? new Date(newLastSyncTime).toISOString() : null
  }
}

// Export the event handler
// In test environments, defineEventHandler is mocked to return the handler directly
const eventHandler = defineEventHandler(async (event) => {
  return handleGetIntegrations(event, {
    getQuery,
    requireAuth,
    requireActiveOrganization,
    getDB,
    assertIntegrationManager,
    getOrganizationIntegrationSyncMetadata,
    listOrganizationIntegrationsWithAccounts,
    syncOrganizationOAuthIntegrations,
    updateOrganizationIntegrationSyncMetadata,
    createError
  })
})

export default eventHandler
