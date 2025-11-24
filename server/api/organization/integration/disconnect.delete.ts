import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { integration, member } from '~~/server/database/schema'
import { eq, and } from 'drizzle-orm'

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

  // Find the integration
  const existing = await db.select().from(integration).where(and(
      eq(integration.organizationId, organizationId),
      eq(integration.provider, provider)
  )).limit(1)

  if (existing.length > 0) {
     await db.delete(integration).where(eq(integration.id, existing[0].id))
  }

  return { success: true }
})

