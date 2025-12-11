import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '../../database/schema'
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

const generateUniqueSlug = async (db: DbInstance, seed: string) => {
  const base = slugify(seed) || `team-${Math.random().toString(36).slice(2, 8)}`
  let candidate = base
  let attempt = 1

  while (true) {
    const [existing] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, candidate))
      .limit(1)

    if (!existing)
      return candidate

    const suffix = Math.random().toString(36).slice(2, 6)
    candidate = `${base}-${suffix}`
    attempt++

    if (attempt > 5) {
      // Last resort: include timestamp to guarantee uniqueness
      candidate = `${base}-${Date.now().toString(36)}`
    }
  }
}

export const setUserActiveOrganization = async (userId: string, organizationId: string) => {
  if (!userId || !organizationId)
    return

  const db = getDB()
  await Promise.all([
    db
      .update(schema.user)
      .set({ lastActiveOrganizationId: organizationId })
      .where(eq(schema.user.id, userId)),
    db
      .update(schema.session)
      .set({ activeOrganizationId: organizationId })
      .where(eq(schema.session.userId, userId))
  ])
}

export const ensureDefaultOrganizationForUser = async (
  user: MinimalUserInfo | null | undefined
): Promise<{ id: string, created: boolean } | null> => {
  if (!user?.id || user.isAnonymous)
    return null

  const db = getDB()
  let result: { id: string, created: boolean } | null = null

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, user.id))
      .limit(1)

    if (existing?.organizationId) {
      result = { id: existing.organizationId, created: false }
      return
    }

    const name = buildDefaultName(user)
    const slug = await generateUniqueSlug(tx, name)
    const now = new Date()
    const orgId = uuidv7()

    await tx
      .insert(schema.organization)
      .values({
        id: orgId,
        name,
        slug,
        createdAt: now,
        metadata: JSON.stringify({ autoProvisioned: true })
      })

    await tx.insert(schema.member).values({
      id: uuidv7(),
      organizationId: orgId,
      userId: user.id,
      role: 'owner',
      createdAt: now
    })

    result = { id: orgId, created: true }
  })

  if (result?.created) {
    await setUserActiveOrganization(user.id, result.id)
  }

  return result
}
