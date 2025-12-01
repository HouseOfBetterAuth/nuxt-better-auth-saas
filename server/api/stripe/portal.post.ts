import { eq } from 'drizzle-orm'
import { organization as organizationTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, returnUrl } = body

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing organizationId'
    })
  }

  const db = await useDB()

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org || !org.stripeCustomerId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No billing account found for this organization'
    })
  }

  const stripe = createStripeClient()

  try {
    // Open the full billing portal - user can update payment method, view invoices, etc.
    // After updating payment method, Stripe will automatically retry failed payments
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: returnUrl || `${process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000'}/${org.slug}/billing`
    })

    return {
      url: portalSession.url
    }
  } catch (e: any) {
    console.error('Failed to create portal session:', e)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create billing portal session'
    })
  }
})
