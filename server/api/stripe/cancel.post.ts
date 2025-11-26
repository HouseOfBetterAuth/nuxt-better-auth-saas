import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { subscriptionId, referenceId } = body

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
    )
  })

  if (!member || member.role !== 'owner') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Only organization owners can cancel subscriptions'
    })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, referenceId)
  })

  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization not found'
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
    console.error('[Stripe cancel] Failed to retrieve subscription', error)
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

  if (!subscriptionOrgId && subscriptionCustomerId && org.stripeCustomerId && subscriptionCustomerId !== org.stripeCustomerId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Subscription customer mismatch'
    })
  }

  if (!subscriptionOrgId && !org.stripeCustomerId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Unable to verify subscription ownership'
    })
  }

  try {
    // Cancel at period end
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    })

    // We need to manually trigger the log function from server/utils/stripe if we want consistency,
    // but `addPaymentLog` is not exported.
    // However, the webhook will eventually fire and log it too.
    // But for immediate UI feedback and audit log, we can try to log if we export it.
    // Since `addPaymentLog` is not exported in `server/utils/stripe.ts`, we'll skip it or export it.
    // I will export it in a subsequent edit if needed, but for now let's just return success.

    return {
      success: true,
      subscription
    }
  } catch (error: any) {
    console.error('Stripe cancel error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to cancel subscription'
    })
  }
})
