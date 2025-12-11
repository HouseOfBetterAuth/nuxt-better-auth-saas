import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { addPaymentLog } from '~~/server/utils/stripe'
import { sendSubscriptionResumedEmail } from '~~/server/utils/stripeEmails'

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
      statusMessage: 'Forbidden: Only organization owners can manage subscriptions'
    })
  }

  const stripe = new Stripe(runtimeConfig.stripeSecretKey!)

  try {
    // Resume subscription (disable cancel_at_period_end)
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    })

    // Log the event
    await addPaymentLog('subscription_resumed', subscription)

    // Send resumed email
    await sendSubscriptionResumedEmail(referenceId, subscription)

    return {
      success: true,
      subscription
    }
  } catch (error: any) {
    console.error('Stripe resume error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to resume subscription'
    })
  }
})
