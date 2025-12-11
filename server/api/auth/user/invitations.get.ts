import { and, eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { requireAuth } from '../../../utils/auth'
import { getDB } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

  const db = getDB()

  const invitations = await db.select()
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.email, user.email),
        eq(schema.invitation.status, 'pending')
      )
    )

  // We might want to fetch organization names too if not included
  // Usually invitations have organizationId

  // Let's enrich with organization details if possible
  // But invitation table usually has organizationId.
  // If we want organization NAME, we need to join.

  const enrichedInvitations = await Promise.all(invitations.map(async (invite) => {
    const orgs = await db.select().from(schema.organization).where(eq(schema.organization.id, invite.organizationId)).limit(1)
    return {
      ...invite,
      organizationName: orgs[0]?.name || 'Unknown Organization'
    }
  }))

  return enrichedInvitations
})
