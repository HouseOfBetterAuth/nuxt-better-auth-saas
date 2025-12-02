import { eq } from 'drizzle-orm'
import { organization as organizationTable } from '../../database/schema'
import { getAuthSession } from '../../utils/auth'
import { useDB } from '../../utils/db'
import { syncStripeCustomerName } from '../../utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session?.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { organizationId, name } = body

  if (!organizationId) {
    throw createError({ statusCode: 400, message: 'organizationId is required' })
  }

  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId),
    with: { members: true }
  })

  if (!org) {
    throw createError({ statusCode: 404, message: 'Organization not found' })
  }

  // Check if user is owner
  const isOwner = org.members.some(m => m.userId === session.user.id && m.role === 'owner')
  if (!isOwner) {
    throw createError({ statusCode: 403, message: 'Only owners can sync billing info' })
  }

  // Sync customer name if org has a Stripe customer
  if (org.stripeCustomerId) {
    await syncStripeCustomerName(organizationId, name)
  }

  return { success: true }
})
