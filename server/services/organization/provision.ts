import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '../../db/schema'
import { orgProvisioningQueue } from '../../db/schema/orgProvisioningQueue'
import { getDB } from '../../utils/db'

type DbInstance = NodePgDatabase<typeof schema>

interface MinimalUserInfo {
  id: string
  name?: string | null
  email?: string | null
  isAnonymous?: boolean | null
}

const slugify = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const buildDefaultName = (user: MinimalUserInfo) => {
  const base =
    user.name?.trim()
    || user.email?.split('@')?.[0]?.trim()
    || 'My'

  // Ensure base is capitalized for display
  const capitalized = base.charAt(0).toUpperCase() + base.slice(1)
  const suffix = capitalized.toLowerCase().includes('team') ? '' : ' Team'
  return `${capitalized}${suffix || ''}`
}

const ADJECTIVES = [
  'fuzzy',
  'curious',
  'brave',
  'gentle',
  'sparkly',
  'swift',
  'quiet',
  'bright',
  'mighty',
  'clever'
] as const

const ANIMALS = [
  'penguin',
  'leopard',
  'otter',
  'fox',
  'tiger',
  'panda',
  'eagle',
  'whale',
  'koala',
  'lynx'
] as const

const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]

const titleCase = (value: string) => value
  .split(/\s+/g)
  .filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ')

const buildRandomOrgNameAndSlugSeed = () => {
  const adjective = pick(ADJECTIVES)
  const animal = pick(ANIMALS)
  const slugSeed = `${adjective}-${animal}`
  const name = titleCase(`${adjective} ${animal}`)
  return { name, slugSeed }
}

const generateUniqueSlug = async (db: DbInstance, seed: string) => {
  const MAX_ATTEMPTS = 10
  const base = slugify(seed) || `team-${Math.random().toString(36).slice(2, 8)}`
  let candidate = base

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, candidate))
      .limit(1)

    if (!existing)
      return candidate

    if (attempt === MAX_ATTEMPTS) {
      break
    }

    if (attempt >= 5) {
      candidate = `${base}-${Date.now().toString(36)}`
    } else {
      const suffix = Math.random().toString(36).slice(2, 6)
      candidate = `${base}-${suffix}`
    }
  }

  throw new Error('Unable to generate a unique organization slug')
}

export const setUserActiveOrganization = async (
  userId: string,
  organizationId: string,
  db?: DbInstance
) => {
  if (!userId || !organizationId)
    return

  const dbInstance = db || getDB()
  await Promise.all([
    dbInstance
      .update(schema.user)
      .set({ lastActiveOrganizationId: organizationId })
      .where(eq(schema.user.id, userId)),
    dbInstance
      .update(schema.session)
      .set({ activeOrganizationId: organizationId })
      .where(eq(schema.session.userId, userId))
  ])
}

/**
 * Queue a failed organization provisioning attempt for retry.
 *
 * Note: retryCount is only incremented by the background retry job (retryQueuedOrgProvisioning).
 * This function only updates the error message when an existing entry is found, ensuring
 * retryCount accurately represents the number of background retry attempts.
 */
const queueOrgProvisioningRetry = async (userId: string, error: Error) => {
  try {
    const db = getDB()
    await db.transaction(async (tx) => {
      // Check if there's already a pending queue entry for this user
      const [existing] = await tx
        .select()
        .from(orgProvisioningQueue)
        .where(and(
          eq(orgProvisioningQueue.userId, userId),
          sql`${orgProvisioningQueue.completedAt} IS NULL`
        ))
        .limit(1)

      if (existing) {
        // Update existing entry with latest error, but don't increment retryCount
        // retryCount is only incremented by the background retry job
        await tx
          .update(orgProvisioningQueue)
          .set({
            error: error.message
            // Note: We don't update lastRetryAt here since this isn't a retry attempt,
            // it's just updating the error message for an existing queued entry
          })
          .where(eq(orgProvisioningQueue.id, existing.id))
      } else {
        // Create new entry
        // The unique constraint on (userId) WHERE completedAt IS NULL will prevent
        // concurrent duplicate inserts
        await tx.insert(orgProvisioningQueue).values({
          userId,
          error: error.message,
          retryCount: 0,
          createdAt: new Date()
        })
      }
    })
  } catch (queueError) {
    // If the unique constraint violation occurs (shouldn't happen with transaction,
    // but handle gracefully), log and continue
    if (queueError instanceof Error && queueError.message.includes('unique')) {
      console.warn('[OrgProvisioning] Duplicate queue entry prevented by unique constraint:', userId)
    } else {
      console.error('[OrgProvisioning] Failed to queue provisioning retry:', queueError)
    }
  }
}

export const ensureDefaultOrganizationForUser = async (
  user: MinimalUserInfo | null | undefined,
  options?: {
    queueOnFailure?: boolean
  }
): Promise<{ id: string, created: boolean } | null> => {
  if (!user?.id || user.isAnonymous)
    return null

  const queueOnFailure = options?.queueOnFailure ?? true
  const db = getDB()

  try {
    const result = await db.transaction(async (tx) => {
      const [existingNonAnonymous] = await tx
        .select({ organizationId: schema.member.organizationId })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(and(
          eq(schema.member.userId, user.id),
          eq(schema.organization.isAnonymous, false)
        ))
        .limit(1)

      if (existingNonAnonymous?.organizationId) {
        return { id: existingNonAnonymous.organizationId, created: false }
      }

      // If the user only has an anonymous org (created while they were anonymous), create a real org.
      const [anonymousOrg] = await tx
        .select({ organizationId: schema.member.organizationId })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(and(
          eq(schema.member.userId, user.id),
          eq(schema.organization.isAnonymous, true)
        ))
        .limit(1)

      const random = buildRandomOrgNameAndSlugSeed()
      const name = random.name || buildDefaultName(user)
      const slug = await generateUniqueSlug(tx, random.slugSeed || name)
      const now = new Date()
      const orgId = uuidv7()

      await tx
        .insert(schema.organization)
        .values({
          id: orgId,
          name,
          slug,
          createdAt: now,
          metadata: JSON.stringify({
            autoProvisioned: true,
            source: anonymousOrg?.organizationId ? 'anon-upgrade' : 'auto-provision'
          })
        })

      await tx.insert(schema.member).values({
        id: uuidv7(),
        organizationId: orgId,
        userId: user.id,
        role: 'owner',
        createdAt: now
      })

      // Migrate anonymous conversations to the newly created org so the user's existing work carries over.
      if (anonymousOrg?.organizationId) {
        await tx
          .update(schema.conversation)
          .set({ organizationId: orgId })
          .where(eq(schema.conversation.organizationId, anonymousOrg.organizationId))

        await tx
          .update(schema.conversationMessage)
          .set({ organizationId: orgId })
          .where(eq(schema.conversationMessage.organizationId, anonymousOrg.organizationId))

        await tx
          .update(schema.conversationLog)
          .set({ organizationId: orgId })
          .where(eq(schema.conversationLog.organizationId, anonymousOrg.organizationId))
      }

      return { id: orgId, created: true }
    })

    if (result) {
      await setUserActiveOrganization(user.id, result.id)
    }

    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error')
    console.error('[OrgProvisioning] Failed to ensure default organization:', err)

    // Queue for retry if enabled
    if (queueOnFailure) {
      await queueOrgProvisioningRetry(user.id, err)
    }

    // Re-throw so caller knows it failed
    throw error
  }
}

/**
 * Retry queued organization provisioning attempts.
 * Should be called periodically by a background job.
 *
 * Note: retryCount represents the number of background retry attempts, not total failures.
 * Initial provisioning failures are queued without incrementing retryCount.
 */
export async function retryQueuedOrgProvisioning(maxRetries: number = 5, batchSize: number = 50) {
  const db = getDB()

  try {
    // Get queued provisioning attempts that haven't exceeded max retries
    const queuedItems = await db
      .select()
      .from(orgProvisioningQueue)
      .where(and(
        sql`${orgProvisioningQueue.retryCount} < ${maxRetries}`,
        sql`${orgProvisioningQueue.completedAt} IS NULL`
      ))
      .limit(batchSize)

    for (const queuedItem of queuedItems) {
      try {
        // Get user info
        const [user] = await db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            isAnonymous: schema.user.isAnonymous
          })
          .from(schema.user)
          .where(eq(schema.user.id, queuedItem.userId))
          .limit(1)

        if (!user) {
          // User doesn't exist - mark as completed (nothing to do)
          await db
            .update(orgProvisioningQueue)
            .set({ completedAt: new Date() })
            .where(eq(orgProvisioningQueue.id, queuedItem.id))
          continue
        }

        // Try provisioning again
        await ensureDefaultOrganizationForUser(user, { queueOnFailure: false })

        // Success - mark as completed
        await db
          .update(orgProvisioningQueue)
          .set({ completedAt: new Date() })
          .where(eq(orgProvisioningQueue.id, queuedItem.id))
      } catch (error) {
        // Failed again - increment retry count
        const newRetryCount = queuedItem.retryCount + 1
        await db
          .update(orgProvisioningQueue)
          .set({
            retryCount: newRetryCount,
            lastRetryAt: new Date(),
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          .where(eq(orgProvisioningQueue.id, queuedItem.id))

        // If exceeded max retries, log for manual investigation
        if (newRetryCount >= maxRetries) {
          console.error(`[OrgProvisioning] Provisioning exceeded max retries (${maxRetries}):`, {
            id: queuedItem.id,
            userId: queuedItem.userId
          })
          await db
            .update(orgProvisioningQueue)
            .set({ completedAt: new Date() })
            .where(eq(orgProvisioningQueue.id, queuedItem.id))
        }
      }
    }
  } catch (error) {
    console.error('[OrgProvisioning] Failed to retry queued provisioning:', error)
  }
}
