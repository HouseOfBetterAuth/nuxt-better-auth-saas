import { and, eq, like } from 'drizzle-orm'
import { apiKey, member } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized'
    })
  }

  const query = getQuery(event)
  const orgId = query.organizationId as string

  if (!orgId) {
    throw createError({
      statusCode: 400,
      message: 'Organization ID is required'
    })
  }

  const db = await useDB()

  // Verify membership
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, session.user.id),
      eq(member.organizationId, orgId)
    )
  })

  if (!membership) {
    throw createError({
      statusCode: 403,
      message: 'You do not have access to this organization'
    })
  }

  // Fetch API keys for this organization
  // We use a broad LIKE query to handle potential double-JSON-encoding in the database
  // which causes issues with standard JSON path queries.
  // We match the organization ID in the metadata text.
  const keys = await db.select().from(apiKey).where(
    like(apiKey.metadata, `%${orgId}%`)
  )

  return keys
})
