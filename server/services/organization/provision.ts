import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '../../db/schema'
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
    const [existingNonAnonymous] = await tx
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(and(
        eq(schema.member.userId, user.id),
        sql`${schema.organization.slug} NOT LIKE 'anonymous-%'`
      ))
      .limit(1)

    if (existingNonAnonymous?.organizationId) {
      result = { id: existingNonAnonymous.organizationId, created: false }
      return
    }

    // If the user only has an anonymous org (created while they were anonymous), create a real org.
    const [anonymousOrg] = await tx
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(and(
        eq(schema.member.userId, user.id),
        sql`${schema.organization.slug} LIKE 'anonymous-%'`
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
        metadata: JSON.stringify({ autoProvisioned: true, source: 'anon-upgrade' })
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

    result = { id: orgId, created: true }
  })

  if (result?.created) {
    await setUserActiveOrganization(user.id, result.id)
  }

  return result
}
