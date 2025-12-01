import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { sendSubscriptionUpdatedEmail } from '~~/server/utils/stripeEmails'
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
  const { organizationId, seats, endTrial, newInterval } = body

  console.log('[update-seats] Request:', { organizationId, seats, endTrial, newInterval })

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

  const stripe = new Stripe(runtimeConfig.stripeSecretKey!)

  // Find active or trialing subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 10, // Fetch a few to be safe
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

  // Determine new price ID if interval changes
  let newPriceId
  if (newInterval) {
    newPriceId = newInterval === 'month'
      ? PLANS.PRO_MONTHLY.priceId
      : PLANS.PRO_YEARLY.priceId
  }

  const subscriptionItemId = subscription.items.data[0].id

  // Update subscription params
  const updateParams: any = {
    items: [{
      id: subscriptionItemId,
      quantity: seats,
      ...(newPriceId ? { price: newPriceId } : {})
    }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'error_if_incomplete' // This will throw an error if payment fails instead of leaving subscription in bad state
  }

  if (endTrial) {
    updateParams.trial_end = 'now'
  }

  let updatedSubscription: any
  try {
    updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams)
  } catch (stripeError: any) {
    console.error('[update-seats] Stripe error:', stripeError.message)

    // Check if it's a card/payment error
    if (stripeError.type === 'StripeCardError' || stripeError.code === 'card_declined') {
      throw createError({
        statusCode: 402,
        statusMessage: 'Your card was declined. Please update your payment method.'
      })
    }

    // Re-throw other errors
    throw createError({
      statusCode: 500,
      statusMessage: stripeError.message || 'Failed to update subscription'
    })
  }

  console.log('[update-seats] Stripe Updated Raw:', {
    id: updatedSubscription.id,
    current_period_end: updatedSubscription.current_period_end,
    status: updatedSubscription.status
  })

  // Update local database immediately
  const periodEnd = updatedSubscription.current_period_end
    ? new Date(updatedSubscription.current_period_end * 1000)
    : undefined

  const updateData: any = {
    seats: updatedSubscription.items?.data?.[0]?.quantity || seats,
    periodEnd: (periodEnd && !Number.isNaN(periodEnd.getTime())) ? periodEnd : undefined
  }

  if (endTrial || updatedSubscription.status === 'active') {
    console.log('[update-seats] Forcing Active Status in DB')
    updateData.status = 'active'

    // If trial was ended, capture the actual trial_end timestamp from Stripe
    if (endTrial && updatedSubscription.trial_end) {
      updateData.trialEnd = new Date(updatedSubscription.trial_end * 1000)
      console.log('[update-seats] Trial ended at:', updateData.trialEnd)
    }

    // Also update any other stale trialing subscriptions for this org to avoid UI confusion
    // (In case of duplicate DB records)
    const bulkUpdateData: any = { status: 'active' }
    if (endTrial && updatedSubscription.trial_end) {
      bulkUpdateData.trialEnd = new Date(updatedSubscription.trial_end * 1000)
    }

    await db.update(subscriptionTable)
      .set(bulkUpdateData)
      .where(and(
        eq(subscriptionTable.referenceId, organizationId),
        eq(subscriptionTable.status, 'trialing')
      ))
  }

  console.log('[update-seats] DB Update Data:', updateData)

  await db.update(subscriptionTable)
    .set(updateData)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

  // Send updated email for seat/plan changes
  if (updatedSubscription.status === 'active') {
    const previousSeats = subscription.items.data[0].quantity
    const newSeats = updatedSubscription.items.data[0].quantity
    await sendSubscriptionUpdatedEmail(organizationId, updatedSubscription, previousSeats, newSeats)
  }

  return { success: true, seats: updatedSubscription.items.data[0].quantity }
})
