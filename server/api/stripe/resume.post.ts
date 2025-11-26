import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { addPaymentLog } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  let body: any
  try {
    body = await readBody(event)
  } catch (error) {
    console.error('Failed to parse resume request body:', error)
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid JSON in request body'
    })
  }

  const { subscriptionId, referenceId } = body || {}

  if (!subscriptionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription ID is required'
    })
  }

  if (!referenceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reference ID (Organization ID) is required'
    })
  }

  // Verify ownership: Check if user is owner of the organization
  const db = await useDB()
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, referenceId),
      eq(memberTable.userId, session.user.id)
    ),
    with: {
      organization: true
    }
  })

  if (!member || member.role !== 'owner') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Only organization owners can manage subscriptions'
    })
  }

  if (!runtimeConfig.stripeSecretKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Stripe configuration is missing'
    })
  }

  const stripe = new Stripe(runtimeConfig.stripeSecretKey)

  let remoteSubscription: Stripe.Subscription
  try {
    remoteSubscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error: any) {
    const status = error?.statusCode || error?.status
    console.error('[Stripe resume] Failed to retrieve subscription', error)
    throw createError({
      statusCode: status === 404 ? 404 : 502,
      statusMessage: status === 404 ? 'Subscription not found' : 'Unable to load subscription information'
    })
  }

  const subscriptionOrgId = remoteSubscription.metadata?.organizationId
  const subscriptionCustomerId = remoteSubscription.customer && typeof remoteSubscription.customer === 'object'
    ? remoteSubscription.customer.id
    : remoteSubscription.customer

  if (subscriptionOrgId && subscriptionOrgId !== referenceId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Subscription does not belong to this organization'
    })
  }

  const orgCustomerId = member.organization?.stripeCustomerId

  if (!subscriptionOrgId && orgCustomerId) {
    if (!subscriptionCustomerId || subscriptionCustomerId !== orgCustomerId) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden: Subscription customer mismatch'
      })
    }
  }

  if (!subscriptionOrgId && !orgCustomerId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Unable to verify subscription ownership'
    })
  }

  if (!remoteSubscription.cancel_at_period_end) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription is not scheduled to cancel'
    })
  }

  try {
    // Resume subscription (disable cancel_at_period_end)
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    })

    // Log the event
    try {
      await addPaymentLog('subscription_resumed', subscription)
    } catch (logError) {
      console.warn('Failed to log subscription resume event', logError)
    }

    return {
      success: true,
      subscription
    }
  } catch (error: unknown) {
    const message = typeof error === 'object' && error && 'message' in error
      ? String((error as any).message)
      : 'Failed to resume subscription'
    console.error('Stripe resume error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: message
    })
  }
})
