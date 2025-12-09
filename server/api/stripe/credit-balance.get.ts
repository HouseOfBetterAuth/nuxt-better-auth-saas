import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const organizationId = query.organizationId as string

  if (!organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing organizationId' })
  }

  const db = await useDB()

  // Verify membership
  const memberRecord = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!memberRecord) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org?.stripeCustomerId) {
    return { creditBalance: 0, currency: 'usd' }
  }

  const stripe = createStripeClient()

  try {
    const customer = await stripe.customers.retrieve(org.stripeCustomerId)

    if (customer.deleted) {
      return { creditBalance: 0, currency: 'usd' }
    }

    // Stripe stores balance as negative for credits (e.g., -5000 = $50 credit)
    // We convert to positive for display
    const balance = (customer as any).balance || 0
    const customerCredit = balance < 0 ? Math.abs(balance) / 100 : 0

    // Also check upcoming invoice for proration credits (negative line items)
    let upcomingCredit = 0
    try {
      const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
        customer: org.stripeCustomerId
      })

      // Sum negative line items (credits/prorations)
      upcomingCredit = upcomingInvoice.lines.data
        .filter((line: any) => line.amount < 0)
        .reduce((sum: number, line: any) => sum + Math.abs(line.amount), 0) / 100

      console.log('[credit-balance] Upcoming invoice lines:', upcomingInvoice.lines.data.map((l: any) => ({
        description: l.description,
        amount: l.amount
      })))
    } catch (e: any) {
      // No upcoming invoice or error
      console.log('[credit-balance] Could not fetch upcoming invoice:', e.message)
    }

    const totalCredit = customerCredit + upcomingCredit

    console.log('[credit-balance] Balance:', { customerCredit, upcomingCredit, totalCredit, rawBalance: balance })

    return {
      creditBalance: totalCredit,
      currency: (customer as any).currency || 'usd'
    }
  } catch (error: any) {
    console.error('[credit-balance] Error fetching customer:', error)
    return { creditBalance: 0, currency: 'usd' }
  }
})
