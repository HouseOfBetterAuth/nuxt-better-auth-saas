import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'
import { sendSubscriptionUpdatedEmail } from '~~/server/utils/stripeEmails'
import { getPlanKeyFromId, getTierForInterval, PLAN_TIERS } from '~~/shared/utils/plans'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, newInterval, newTierKey } = body

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

  // Get local subscription to determine current plan
  const localSub = await db.query.subscription.findFirst({
    where: eq(subscriptionTable.stripeSubscriptionId, subscription.id)
  })
  if (!localSub) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Local subscription record not found'
    })
  }

  const currentPriceId = subscription.items.data[0].price.id

  // Get user's current tier (pro, business, etc.)
  const currentTierKey = getPlanKeyFromId(localSub?.plan)
  const currentInterval = localSub?.plan?.includes('year') ? 'year' : 'month'

  if (currentTierKey === 'free' && !newTierKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Free tier does not support interval changes. Please select a paid plan.'
    })
  }

  // Determine target tier: use newTierKey if provided, otherwise keep current tier
  const targetTierKey = (newTierKey && PLAN_TIERS[newTierKey as keyof typeof PLAN_TIERS])
    ? newTierKey
    : currentTierKey

  const newPlan = getTierForInterval(targetTierKey as Exclude<typeof targetTierKey, 'free'>, newInterval)
  const newPriceId = newPlan.priceId

  if (currentPriceId === newPriceId) {
    return { success: true, message: 'Already on this plan' }
  }

  // Determine if this is an upgrade or downgrade
  const currentTier = PLAN_TIERS[currentTierKey as keyof typeof PLAN_TIERS]
  const targetTier = PLAN_TIERS[targetTierKey as keyof typeof PLAN_TIERS]

  if (!currentTier || !targetTier) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to determine plan tiers'
    })
  }

  // For downgrades, schedule at period end instead of immediate
  const isDowngrade = (
    targetTier.order < currentTier.order ||
    (targetTier.order === currentTier.order && newInterval === 'month' && currentInterval === 'year')
  )

  const quantity = subscription.items.data[0].quantity ?? 1

  // All plan tier downgrades are scheduled at period end (no credit)
  // This prevents revenue loss - users keep features until renewal
  if (isDowngrade) {
    console.log('[change-plan] Plan downgrade - scheduling at period end')

    try {
      // Create a subscription schedule from the existing subscription
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id
      })

      // Update the schedule to change plan at next phase (period end)
      const currentPhase = schedule.phases[0]
      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: subscription.items.data[0].price.id, quantity }],
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date
          },
          {
            items: [{ price: newPriceId, quantity }],
            start_date: currentPhase.end_date
          }
        ],
        end_behavior: 'release' // Release back to regular subscription after schedule completes
      })

      const periodEnd = subscription.current_period_end

      await db.update(subscriptionTable)
        .set({
          scheduledPlanId: newPlan.id,
          scheduledPlanInterval: newInterval,
          scheduledPlanSeats: quantity
        })
        .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

      return {
        success: true,
        message: 'Plan change scheduled',
        newPlan: newPlan.id,
        isUpgrade: false,
        isDowngrade: true,
        scheduledAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null
      }
    } catch (scheduleError: any) {
      console.error('[change-plan] Schedule error:', scheduleError.message)
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to schedule plan change: ${scheduleError.message}`
      })
    }
  }

  // Build update params for upgrades only
  const updateParams: any = {
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId,
      quantity
    }],
    // Upgrade: Immediate with proration
    proration_behavior: 'always_invoice',
    payment_behavior: 'error_if_incomplete'
  }
  console.log('[change-plan] Upgrade detected - applying with proration')

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

  // Note: Plan downgrades are handled above with subscription schedules
  // No credit is given for plan downgrades - only seat downgrades get credit

  // Update local database immediately
  const updateData: any = {
    plan: newPlan.id,
    scheduledPlanId: null,
    scheduledPlanInterval: null,
    scheduledPlanSeats: null
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
    const previousInterval = localSub?.plan?.includes('year') ? 'yearly' : 'monthly'
    const newIntervalLabel = newInterval === 'month' ? 'monthly' : 'yearly'
    await sendSubscriptionUpdatedEmail(organizationId, updatedSub, undefined, undefined, previousInterval, newIntervalLabel)
  }

  return {
    success: true,
    message: 'Plan upgraded',
    newPlan: newPlan.id,
    isUpgrade: true,
    isDowngrade: false
  }
})
