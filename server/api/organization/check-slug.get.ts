import { eq } from 'drizzle-orm'
import { organization } from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { slug } = getQuery(event)
  if (!slug || typeof slug !== 'string')
    return { available: false }

  const db = getDB()
  // Check if slug is reserved or taken
  const reservedSlugs = ['admin', 'dashboard', 'login', 'register', 'settings', 'api', 'auth']
  if (reservedSlugs.includes(slug.toLowerCase())) {
    return { available: false }
  }

  const existing = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).limit(1)

  return { available: existing.length === 0 }
})
