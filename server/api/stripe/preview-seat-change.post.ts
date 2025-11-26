import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
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

  const parsedSeats = Number.parseInt(`${seats}`, 10)

  if (!organizationId || Number.isNaN(parsedSeats)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields'
    })
  }

  if (!Number.isFinite(parsedSeats) || parsedSeats < 1 || parsedSeats > 10000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Seats must be an integer between 1 and 10000'
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

  const orgStripeCustomerId = org.stripeCustomerId as string

  const stripe = createStripeClient()

  type StripeSubscription = Stripe.Subscription & { current_period_start?: number | null }

  const listSubscriptions = async (status: 'active' | 'trialing'): Promise<StripeSubscription[]> => {
    const subs = await stripe.subscriptions.list({
      customer: orgStripeCustomerId,
      status,
      limit: 100
    })
    return subs.data
  }

  let candidateSubscriptions = await listSubscriptions('active')
  if (!candidateSubscriptions.length) {
    candidateSubscriptions = await listSubscriptions('trialing')
  }

  if (!candidateSubscriptions.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Subscription not found'
    })
  }

  const subscription = candidateSubscriptions.reduce<StripeSubscription | null>((latest, current) => {
    if (!latest)
      return current
    const latestStart = latest.current_period_start ?? 0
    const currentStart = current.current_period_start ?? 0
    return currentStart > latestStart ? current : latest
  }, null)

  if (!subscription) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Subscription not found'
    })
  }

  // If currently trialing, calculate locally and return immediately (No Proration/Stripe API needed)
  if (subscription.status === 'trialing') {
    const currentInterval = subscription.items.data[0]?.price?.recurring?.interval || 'month'
    const interval = newInterval || currentInterval
    const planConfig = interval === 'year' ? PLANS.PRO_YEARLY : PLANS.PRO_MONTHLY

    // Calculate total: Base Price + (Additional Seats * Seat Price)
    // Base Plan covers 1st seat. Additional seats = seats - 1.
    // Example: Base $99.99 + ((2-1) Seat * $50.00) = $149.99
    const additionalSeats = Math.max(0, parsedSeats - 1)
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
    if (newInterval !== 'month' && newInterval !== 'year') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid newInterval; must be "month" or "year"'
      })
    }
    newPriceId = newInterval === 'month'
      ? runtimeConfig.stripePriceIdProMonth
      : runtimeConfig.stripePriceIdProYear
  }

  const firstItem = subscription.items.data[0]
  if (!firstItem) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription has no items to update'
    })
  }

  const subscriptionItemId = firstItem.id
  const currentItem = firstItem
  const priceId = newPriceId || currentItem.price.id

  // Use Stripe SDK v20 - createPreview supports flexible billing mode
  let upcomingInvoice
  try {
    upcomingInvoice = await stripe.invoices.createPreview({
      subscription: subscription.id,
      subscription_details: {
        proration_behavior: 'always_invoice',
        items: [
          {
            id: subscriptionItemId,
            quantity: parsedSeats,
            price: priceId
          }
        ]
      }
    })
    console.log('Stripe preview invoice:', upcomingInvoice.amount_due)
  } catch (e: any) {
    console.error('Stripe Invoice Preview Error:', e)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to calculate preview. ${e.message || ''}`
    })
  }

  return {
    amountDue: upcomingInvoice.amount_due,
    total: upcomingInvoice.total,
    subtotal: upcomingInvoice.subtotal,
    currency: upcomingInvoice.currency,
    periodEnd: upcomingInvoice.period_end,
    lines: upcomingInvoice.lines.data
  }
})
