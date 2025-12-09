import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'
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
  const { organizationId, newInterval } = body

  if (!organizationId || !newInterval) {
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

  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 1,
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

  const firstItem = subscription.items.data[0]
  if (!firstItem?.price?.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription is missing price information'
    })
  }

  const currentPriceId = firstItem.price.id
  const monthlyPriceId = PLANS.PRO_MONTHLY.priceId
  const yearlyPriceId = PLANS.PRO_YEARLY.priceId

  const newPriceId = newInterval === 'month' ? monthlyPriceId : yearlyPriceId

  if (currentPriceId === newPriceId) {
    return { success: true, message: 'Already on this plan' }
  }

  if (newInterval === 'month') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Downgrading from yearly to monthly is not supported'
    })
  }

  const quantity = firstItem.quantity ?? 1

  // Upgrade (M -> Y): Immediate with Proration
  const updateParams: any = {
    items: [{
      id: firstItem.id,
      price: newPriceId,
      quantity
    }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'error_if_incomplete' // Fail fast if payment fails, don't leave subscription in bad state
  }

  if (subscription.status === 'trialing') {
    updateParams.trial_end = 'now'
  }

  let updatedSub: any
  try {
    updatedSub = await stripe.subscriptions.update(subscription.id, updateParams)
  } catch (stripeError: any) {
    console.error('[change-plan] Stripe error:', stripeError.message)

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
      statusMessage: stripeError.message || 'Failed to change plan'
    })
  }

  // Update local database immediately
  const updateData: any = {
    plan: PLANS.PRO_YEARLY.id
  }

  if (subscription.status === 'trialing' || updatedSub.status === 'active') {
    updateData.status = 'active'

    // If trial was ended (status changed from trialing to active), capture the trial_end timestamp
    if (subscription.status === 'trialing' && updatedSub.status === 'active' && updatedSub.trial_end) {
      updateData.trialEnd = new Date(updatedSub.trial_end * 1000)
      if (process.env.NODE_ENV === 'development') {
        console.log('[change-plan] Trial ended at:', updateData.trialEnd)
      }
    }
  }

  await db.update(subscriptionTable)
    .set(updateData)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

  // Send updated email for plan change
  if (updatedSub.status === 'active') {
    const previousInterval = currentPriceId === monthlyPriceId ? 'monthly' : 'yearly'
    const newIntervalLabel = newInterval === 'month' ? 'monthly' : 'yearly'
    await sendSubscriptionUpdatedEmail(organizationId, updatedSub, undefined, undefined, previousInterval, newIntervalLabel)
  }

  return { success: true, message: 'Upgraded to yearly plan' }
})
