import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { sendSubscriptionUpdatedEmail } from '~~/server/utils/stripeEmails'
import { getPlanKeyFromId, getTierForInterval } from '~~/shared/utils/plans'

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

  if (process.env.NODE_ENV === 'development') {
    console.log('[update-seats] Request:', { organizationId, seats, endTrial, newInterval })
  }

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

  let newPriceId
  if (newInterval) {
    // Get user's current tier from local subscription
    const localSub = await db.query.subscription.findFirst({
      where: eq(subscriptionTable.stripeSubscriptionId, subscription.id)
    })
    const tierKey = getPlanKeyFromId(localSub?.plan)
    const effectiveTierKey = tierKey === 'free' ? 'pro' : tierKey
    newPriceId = getTierForInterval(effectiveTierKey, newInterval).priceId
  }

  const subscriptionItemId = subscription.items.data[0].id
  const currentSeats = subscription.items.data[0].quantity || 1
  const isDowngrade = seats < currentSeats

  // Update subscription params
  // For downgrades: use 'none' - no proration, no credit (seats just reduce)
  // For upgrades: use 'always_invoice' - charge prorated amount immediately
  const updateParams: any = {
    items: [{
      id: subscriptionItemId,
      quantity: seats,
      ...(newPriceId ? { price: newPriceId } : {})
    }],
    proration_behavior: isDowngrade ? 'none' : 'always_invoice',
    ...(isDowngrade ? {} : { payment_behavior: 'error_if_incomplete' })
  }

  console.log('[update-seats] Updating seats:', {
    currentSeats,
    newSeats: seats,
    isDowngrade,
    proration: isDowngrade ? 'none' : 'always_invoice'
  })

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

  console.log('[update-seats] Stripe updated:', {
    id: updatedSubscription.id,
    status: updatedSubscription.status,
    newQuantity: updatedSubscription.items?.data?.[0]?.quantity
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
    if (process.env.NODE_ENV === 'development') {
      console.log('[update-seats] Forcing Active Status in DB')
    }
    updateData.status = 'active'

    // If trial was ended, capture the actual trial_end timestamp from Stripe
    if (endTrial && updatedSubscription.trial_end) {
      updateData.trialEnd = new Date(updatedSubscription.trial_end * 1000)
      if (process.env.NODE_ENV === 'development') {
        console.log('[update-seats] Trial ended at:', updateData.trialEnd)
      }
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

  if (process.env.NODE_ENV === 'development') {
    console.log('[update-seats] DB Update Data:', updateData)
  }

  await db.update(subscriptionTable)
    .set(updateData)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

  // Send updated email for seat/plan changes
  if (updatedSubscription.status === 'active') {
    const previousSeats = currentItem.quantity ?? seats
    const newSeats = updatedSubscription.items?.data?.[0]?.quantity ?? seats
    await sendSubscriptionUpdatedEmail(organizationId, updatedSubscription, previousSeats, newSeats)
  }

  return { success: true, seats: updatedSubscription.items?.data?.[0]?.quantity ?? seats }
})
