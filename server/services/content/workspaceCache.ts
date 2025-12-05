import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getContentWorkspacePayload } from './workspace'
import * as schema from '~~/server/database/schema'

export type WorkspacePayload = Awaited<ReturnType<typeof getContentWorkspacePayload>>

interface CacheEntry {
  payload: WorkspacePayload
  expiresAt: number
}

const WORKSPACE_CACHE_TTL_MS = 30_000
const workspaceCache = new Map<string, CacheEntry>()

function cacheKey(organizationId: string, contentId: string, includeChat: boolean) {
  return `${organizationId}:${contentId}:chat:${includeChat ? '1' : '0'}`
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

  const payload = await getContentWorkspacePayload(db, organizationId, contentId, { includeChat })
  workspaceCache.set(key, {
    payload,
    expiresAt: now + WORKSPACE_CACHE_TTL_MS
  })
  return payload
}
