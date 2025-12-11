import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable } from '~~/server/db/schema'
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

  const stripe = new Stripe(runtimeConfig.stripeSecretKey!)

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
