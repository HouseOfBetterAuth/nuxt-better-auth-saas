import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'
import { getContentWorkspacePayload } from './workspace'

export type WorkspacePayload = Awaited<ReturnType<typeof getContentWorkspacePayload>>

interface CacheEntry {
  payload: WorkspacePayload
  expiresAt: number
}

const WORKSPACE_CACHE_TTL_MS = 30_000
const MAX_CACHE_SIZE = 500
const workspaceCache = new Map<string, CacheEntry>()
const inFlightRequests = new Map<string, Promise<WorkspacePayload>>()

function cacheKey(organizationId: string, contentId: string, includeChat: boolean) {
  return `${organizationId}:${contentId}:chat:${includeChat ? '1' : '0'}`
}

function evictOldestIfNeeded() {
  if (workspaceCache.size < MAX_CACHE_SIZE) {
    return
  }
  const firstKey = workspaceCache.keys().next().value
  if (firstKey) {
    workspaceCache.delete(firstKey)
  }
}

export function clearWorkspaceCache() {
  workspaceCache.clear()
}

export function invalidateWorkspaceCache(organizationId: string, contentId: string) {
  workspaceCache.delete(cacheKey(organizationId, contentId, true))
  workspaceCache.delete(cacheKey(organizationId, contentId, false))
}

export async function getWorkspaceWithCache(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  contentId: string,
  options?: { includeChat?: boolean }
) {
  const includeChat = options?.includeChat !== false
  const key = cacheKey(organizationId, contentId, includeChat)
  const existing = workspaceCache.get(key)
  const now = Date.now()

  if (existing && existing.expiresAt > now) {
    return existing.payload
  }

  const pending = inFlightRequests.get(key)
  if (pending) {
    return pending
  }

  const fetchPromise = getContentWorkspacePayload(db, organizationId, contentId, { includeChat })
    .then((payload) => {
      evictOldestIfNeeded()
      workspaceCache.delete(key)
      workspaceCache.set(key, {
        payload,
        expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS
      })
      return payload
    })
    .finally(() => {
      inFlightRequests.delete(key)
    })

  inFlightRequests.set(key, fetchPromise)
  return fetchPromise
}
