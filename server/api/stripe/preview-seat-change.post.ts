import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'
import { PLANS } from '~~/shared/utils/plans'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, seats, newInterval } = body

  if (!organizationId || !seats) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields'
    })
  }

  const db = await useDB()

  // Verify ownership
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!member || member.role !== 'owner') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden'
    })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org || !org.stripeCustomerId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization or Stripe Customer not found'
    })
  }

  const stripe = createStripeClient()

  // Find subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 10,
    status: 'all'
  })

  const subscription = subscriptions.data.find(sub =>
    sub.status === 'active' || sub.status === 'trialing'
  )

  if (!subscription) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No active subscription found'
    })
  }

  // If currently trialing, calculate locally and return immediately (No Proration/Stripe API needed)
  if (subscription.status === 'trialing') {
    const interval = newInterval || (subscription as any).plan.interval

    // Find the correct plan config to support Legacy Pricing
    // We must check the LOCAL database to see which Plan Version (V1, V2, V3) the user is on,
    // because they might share the same Stripe Price ID.
    const localSub = await db.query.subscription.findFirst({
      where: eq(subscriptionTable.stripeSubscriptionId, subscription.id)
    })

    let planConfig
    if (localSub && localSub.plan) {
      planConfig = Object.values(PLANS).find(p => p.id === localSub.plan)
    }

    // If not found in DB (or switching interval), fallback to checking Stripe Price ID match
    // This handles cases where DB might be out of sync or missing
    if (!planConfig) {
      planConfig = Object.values(PLANS).find(p => p.priceId === (subscription as any).plan.id)
    }

    // If STILL not found (or switching interval), fallback to the standard plan for that interval
    if (!planConfig || planConfig.interval !== interval) {
      planConfig = interval === 'year' ? PLANS.PRO_YEARLY : PLANS.PRO_MONTHLY
    }

    // Calculate total: Base Price + (Additional Seats * Seat Price)
    // Base Plan covers 1st seat. Additional seats = seats - 1.
    // Example: Base $99.99 + ((2-1) Seat * $50.00) = $149.99
    const additionalSeats = Math.max(0, seats - 1)
    const totalCents = Math.round((planConfig.priceNumber + (additionalSeats * planConfig.seatPriceNumber)) * 100)

    return {
      amountDue: totalCents,
      total: totalCents,
      subtotal: totalCents,
      currency: subscription.currency || 'usd',
      periodEnd: Math.floor(Date.now() / 1000) + (interval === 'year' ? 31536000 : 2592000),
      lines: []
    }
  }

  // Determine new price if interval changes
  let newPriceId
  if (newInterval) {
    newPriceId = newInterval === 'month'
      ? PLANS.PRO_MONTHLY.priceId
      : PLANS.PRO_YEARLY.priceId
  }

  const subscriptionItemId = subscription.items.data[0].id
  const currentItem = subscription.items.data[0]
  const priceId = newPriceId || currentItem.price.id

  // Use Stripe SDK v20 - createPreview supports flexible billing mode
  let upcomingInvoice
  try {
    console.log('[preview-seat-change] Creating preview with:', {
      subscriptionId: subscription.id,
      subscriptionItemId,
      seats,
      priceId,
      newInterval,
      currentPriceId: currentItem.price.id
    })

    upcomingInvoice = await stripe.invoices.createPreview({
      subscription: subscription.id,
      subscription_details: {
        proration_behavior: 'always_invoice',
        items: [
          {
            id: subscriptionItemId,
            quantity: seats,
            price: priceId
          }
        ]
      }
    })

    console.log('[preview-seat-change] Stripe preview result:', {
      amount_due: upcomingInvoice.amount_due,
      total: upcomingInvoice.total,
      subtotal: upcomingInvoice.subtotal,
      lines: upcomingInvoice.lines.data.map(l => ({
        description: l.description,
        amount: l.amount
      }))
    })
  } catch (e: any) {
    console.error('Stripe Invoice Preview Error:', e)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to calculate preview. ${e.message || ''}`
    })
  }

  // For yearly upgrades, the next billing date is 1 year from now (not the current period end)
  let periodEnd = upcomingInvoice.period_end
  if (newInterval === 'year') {
    // When upgrading to yearly, next charge is 1 year from today
    periodEnd = Math.floor(Date.now() / 1000) + 31536000 // 365 days in seconds
  }

  return {
    amountDue: upcomingInvoice.amount_due,
    total: upcomingInvoice.total,
    subtotal: upcomingInvoice.subtotal,
    currency: upcomingInvoice.currency,
    periodEnd,
    lines: upcomingInvoice.lines.data
  }
})
