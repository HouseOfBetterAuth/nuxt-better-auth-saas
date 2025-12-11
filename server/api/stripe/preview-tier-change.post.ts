import type { PlanInterval, PlanKey } from '~~/shared/utils/plans'
import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'
import { getPlanByStripePriceId, getTierForInterval, PLAN_TIERS } from '~~/shared/utils/plans'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { organizationId, newTierKey, newInterval } = body as {
    organizationId: string
    newTierKey: Exclude<PlanKey, 'free'>
    newInterval: PlanInterval
  }

  if (!organizationId || !newTierKey || !newInterval) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields' })
  }

  const db = await useDB()

  // Verify ownership
  const memberRecord = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!memberRecord || memberRecord.role !== 'owner') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org?.stripeCustomerId) {
    throw createError({ statusCode: 404, statusMessage: 'Organization or Stripe Customer not found' })
  }

  const stripe = createStripeClient()

  // Get current subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 10,
    status: 'active'
  })

  let subscription = subscriptions.data[0]

  // If no active subscriptions, check for trialing ones
  if (!subscription) {
    const trialingSubs = await stripe.subscriptions.list({
      customer: org.stripeCustomerId,
      limit: 1,
      status: 'trialing'
    })
    subscription = trialingSubs.data[0]
  }

  if (!subscription) {
    throw createError({ statusCode: 400, statusMessage: 'No active subscription found' })
  }

  // Get current plan info from STRIPE (source of truth), not local DB
  const stripePrice = subscription.items.data[0].price
  const stripePriceId = stripePrice.id
  const stripeInterval = stripePrice.recurring?.interval as 'month' | 'year' || 'month'

  // Find which plan this price belongs to using Stripe price ID
  const stripePlanInfo = getPlanByStripePriceId(stripePriceId)
  if (!stripePlanInfo) {
    console.warn('[preview-tier-change] Unknown Stripe price ID:', stripePriceId)
  }
  const stripeTierKey = stripePlanInfo?.tierKey || 'pro'

  // Also get local sub for reference
  const localSub = await db.query.subscription.findFirst({
    where: eq(subscriptionTable.stripeSubscriptionId, subscription.id)
  })

  // Use Stripe as source of truth for current plan
  const currentTierKey = stripeTierKey
  const currentInterval: PlanInterval = stripeInterval
  const currentTier = PLAN_TIERS[currentTierKey as Exclude<PlanKey, 'free'>]
  const targetTier = PLAN_TIERS[newTierKey]

  console.log('[preview-tier-change] Plan info:', {
    stripePriceId,
    stripeInterval,
    stripeTierKey,
    localSubPlan: localSub?.plan,
    currentTierKey,
    currentInterval,
    currentTierName: currentTier?.name,
    newTierKey,
    newInterval
  })

  if (!targetTier) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid tier' })
  }

  const newPlan = getTierForInterval(newTierKey, newInterval)
  const currentPlan = currentTier ? getTierForInterval(currentTierKey as Exclude<PlanKey, 'free'>, currentInterval) : null

  // Determine if upgrade or downgrade
  const isUpgrade = !currentTier ||
    targetTier.order > currentTier.order ||
    (targetTier.order === currentTier.order && newInterval === 'year' && currentInterval === 'month')

  const isDowngrade = currentTier && (
    targetTier.order < currentTier.order ||
    (targetTier.order === currentTier.order && newInterval === 'month' && currentInterval === 'year')
  )

  // All plan tier downgrades are scheduled at period end (no credit)
  // Only seat downgrades get prorated credit
  const isScheduledDowngrade = isDowngrade

  const isSamePlan = currentTierKey === newTierKey && currentInterval === newInterval

  if (isSamePlan) {
    return {
      isSamePlan: true,
      message: 'You are already on this plan'
    }
  }

  // All plan tier downgrades are scheduled at period end (no credit)
  // This prevents revenue loss - users keep features until renewal
  if (isScheduledDowngrade) {
    // Retrieve the full subscription to get current_period_end
    const fullSubscription = await stripe.subscriptions.retrieve(subscription.id)

    // Try billing_cycle_anchor if current_period_end doesn't exist
    let periodEndTimestamp = fullSubscription.current_period_end
    if (!periodEndTimestamp) {
      // Calculate next period from billing_cycle_anchor
      const anchor = fullSubscription.billing_cycle_anchor
      const interval = fullSubscription.plan?.interval || 'month'
      if (anchor) {
        const anchorDate = new Date(anchor * 1000)
        if (interval === 'year') {
          anchorDate.setFullYear(anchorDate.getFullYear() + 1)
        } else if (interval === 'week') {
          anchorDate.setDate(anchorDate.getDate() + 7)
        } else if (interval === 'day') {
          anchorDate.setDate(anchorDate.getDate() + 1)
        } else {
          anchorDate.setMonth(anchorDate.getMonth() + 1)
        }
        periodEndTimestamp = Math.floor(anchorDate.getTime() / 1000)
      }
    }

    const periodEnd = periodEndTimestamp
      ? new Date(periodEndTimestamp * 1000)
      : null
    const qty = subscription.items.data[0].quantity || 1

    return {
      isTrialing: false,
      currentPlan: currentPlan
        ? {
            tierKey: currentTierKey,
            tierName: currentTier?.name || 'Pro',
            interval: currentInterval,
            price: currentPlan.price,
            seatPrice: currentPlan.seatPrice
          }
        : null,
      newPlan: {
        tierKey: newTierKey,
        tierName: targetTier.name,
        interval: newInterval,
        price: newPlan.price,
        seatPrice: newPlan.seatPrice
      },
      isUpgrade: false,
      isDowngrade: true,
      isScheduledDowngrade: true, // Flag for UI to show different message
      seats: qty,
      periodEnd: periodEnd ? periodEnd.toISOString() : null,
      paymentMethod: null, // Not needed for scheduled downgrade
      message: `Your plan will change to ${targetTier.name} on ${periodEnd?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You'll keep ${currentTier?.name} features until then.`
    }
  }

  // Get payment method info
  let paymentMethod = null
  const pmId = subscription.default_payment_method
  if (pmId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(typeof pmId === 'string' ? pmId : pmId.id)
      if (pm.card) {
        paymentMethod = {
          type: 'card',
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year
        }
      }
    } catch (e) {
      console.error('[preview-tier-change] Error fetching payment method:', e)
    }
  }

  // For trialing subscriptions, no proration - they just switch plans
  if (subscription.status === 'trialing') {
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null

    return {
      isTrialing: true,
      trialEnd: trialEnd?.toISOString(),
      currentPlan: currentPlan
        ? {
            tierKey: currentTierKey,
            tierName: currentTier?.name || 'Pro',
            interval: currentInterval,
            price: currentPlan.price,
            seatPrice: currentPlan.seatPrice
          }
        : null,
      newPlan: {
        tierKey: newTierKey,
        tierName: targetTier.name,
        interval: newInterval,
        price: newPlan.price,
        seatPrice: newPlan.seatPrice
      },
      isUpgrade,
      isDowngrade,
      seats: subscription.items.data[0].quantity || 1,
      paymentMethod,
      message: 'Your trial will continue. You will be charged the new plan price when your trial ends.'
    }
  }

  // For active subscriptions, get proration preview from Stripe
  const quantity = subscription.items.data[0].quantity || 1

  try {
    // Use Stripe's invoice preview to get exact proration amounts
    // For both upgrades and downgrades, use create_prorations to see the credit/charge
    const upcomingInvoice = await stripe.invoices.createPreview({
      customer: org.stripeCustomerId,
      subscription: subscription.id,
      subscription_details: {
        items: [{
          id: subscription.items.data[0].id,
          price: newPlan.priceId,
          quantity
        }],
        proration_behavior: 'create_prorations'
      }
    })

    // Debug: Log all line items
    console.log('[preview-tier-change] Invoice lines:', upcomingInvoice.lines.data.map((line: any) => ({
      description: line.description,
      amount: line.amount,
      proration: line.proration,
      period: line.period
    })))

    // Separate proration items from recurring subscription items
    // Proration items have descriptions like "Unused time on..." or "Remaining time on..."
    // Recurring items are the full subscription charges for the next period
    const allLines = upcomingInvoice.lines.data

    // Filter for proration-related line items only
    // These typically have "Unused time on..." or "Remaining time on..." in description
    // We must NOT include the next billing cycle charge (which also has "after [date]")
    const prorationLines = allLines.filter((line: any) => {
      // Only include lines explicitly marked as proration
      // Or lines with "Unused time" or "Remaining time" which are proration credits/charges
      const desc = (line.description || '').toLowerCase()
      const isProrationDesc = desc.includes('unused time') || desc.includes('remaining time')

      return line.proration === true || isProrationDesc
    })

    console.log('[preview-tier-change] Proration lines:', prorationLines.map((line: any) => ({
      description: line.description,
      amount: line.amount
    })))

    // Calculate amounts from proration line items only
    const creditAmount = prorationLines
      .filter((line: any) => line.amount < 0)
      .reduce((sum: number, line: any) => sum + Math.abs(line.amount), 0) / 100
    const chargeAmount = prorationLines
      .filter((line: any) => line.amount > 0)
      .reduce((sum: number, line: any) => sum + line.amount, 0) / 100

    // Net amount due is credit - charge (for proration only)
    const netAmount = chargeAmount - creditAmount

    // For upgrades: charge the net proration amount
    // For downgrades: scheduled at end of billing cycle, no immediate charge or credit
    const immediateCharge = isUpgrade ? Math.max(0, netAmount) : 0

    console.log('[preview-tier-change] Calculated:', { creditAmount, chargeAmount, netAmount, immediateCharge, isDowngrade, isUpgrade })

    // Period end date
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null

    // Build message based on upgrade/downgrade
    let message = ''
    if (isUpgrade) {
      message = `You will be charged $${immediateCharge.toFixed(2)} now (prorated for remaining billing period).`
    } else if (isDowngrade) {
      message = `Your plan will change to ${targetTier.name} on your next billing date. No charge today.`
    } else {
      message = 'Your plan will be updated immediately.'
    }

    return {
      isTrialing: false,
      currentPlan: currentPlan
        ? {
            tierKey: currentTierKey,
            tierName: currentTier?.name || 'Pro',
            interval: currentInterval,
            price: currentPlan.price,
            seatPrice: currentPlan.seatPrice
          }
        : null,
      newPlan: {
        tierKey: newTierKey,
        tierName: targetTier.name,
        interval: newInterval,
        price: newPlan.price,
        seatPrice: newPlan.seatPrice
      },
      isUpgrade,
      isDowngrade,
      seats: quantity,
      proration: {
        credit: creditAmount,
        charge: chargeAmount,
        netAmount,
        immediateCharge,
        amountDue: isUpgrade ? immediateCharge : 0,
        effectiveDate: new Date().toISOString()
      },
      periodEnd: periodEnd?.toISOString(),
      paymentMethod,
      message
    }
  } catch (error: any) {
    console.error('[preview-tier-change] Stripe error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to preview plan change'
    })
  }
})
