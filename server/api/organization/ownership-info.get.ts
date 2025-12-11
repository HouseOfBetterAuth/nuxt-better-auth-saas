import { and, asc, eq } from 'drizzle-orm'
import { member, organization } from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = getDB()

  const ownedMemberships = await db
    .select({
      organizationId: member.organizationId,
      createdAt: organization.createdAt
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(
      eq(member.userId, user.id),
      eq(member.role, 'owner')
    ))
    .orderBy(asc(organization.createdAt))

  return {
    ownedCount: ownedMemberships.length,
    firstOwnedOrgId: ownedMemberships[0]?.organizationId ?? null
  }
})
