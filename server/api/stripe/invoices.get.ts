import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const query = getQuery(event)
  const organizationId = query.organizationId as string
  const limit = Math.min(Number(query.limit) || 10, 100)
  const startingAfter = query.startingAfter as string | undefined

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing organizationId'
    })
  }

  const db = await useDB()

  // Verify membership
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!member) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden'
    })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org || !org.stripeCustomerId) {
    return {
      invoices: [],
      hasMore: false
    }
  }

  // Get the subscription for this organization to filter invoices
  const orgSubscription = await db.query.subscription.findFirst({
    where: eq(subscriptionTable.referenceId, organizationId)
  })

  const stripe = createStripeClient()

  try {
    // Fetch invoices filtered by this organization's subscription
    // This ensures users with multiple orgs only see invoices for this specific org
    const invoices = await stripe.invoices.list({
      customer: org.stripeCustomerId,
      limit,
      starting_after: startingAfter || undefined,
      ...(orgSubscription?.stripeSubscriptionId && { subscription: orgSubscription.stripeSubscriptionId })
    })

    return {
      invoices: invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount: inv.amount_paid,
        currency: inv.currency,
        created: inv.created,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        description: inv.description || inv.lines.data[0]?.description || 'Subscription'
      })),
      hasMore: invoices.has_more
    }
  } catch (e: any) {
    console.error('Failed to fetch invoices:', e)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch invoices'
    })
  }
})
