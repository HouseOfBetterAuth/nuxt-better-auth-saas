import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { createStripeClient } from '~~/server/utils/stripe'

/**
 * Returns `value` as an absolute URL when it points back to this app:
 * an absolute URL on the origin of `baseURL`, or a path starting with a
 * single `/`. Anything else (another origin, `//host`, `javascript:`,
 * a non-string) returns undefined, so the portal cannot redirect away.
 */
function sameOriginUrl(value: unknown, baseURL: string): string | undefined {
  if (typeof value !== 'string' || value === '')
    return undefined
  const isPath = value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
  try {
    const base = new URL(baseURL)
    const url = isPath ? new URL(value, base) : new URL(value)
    return url.origin === base.origin ? url.href : undefined
  } catch {
    return undefined
  }
}

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

  // Verify that the user belongs to this organization
  const membership = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!membership) {
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
      statusCode: 400,
      statusMessage: 'No billing account found for this organization'
    })
  }

  const stripe = createStripeClient()
  const baseURL = runtimeConfig.public.baseURL || 'http://localhost:3000'

  try {
    // Open the full billing portal - user can update payment method, view invoices, etc.
    // After updating payment method, Stripe will automatically retry failed payments
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: sameOriginUrl(returnUrl, baseURL) ?? `${baseURL}/${org.slug}/billing`
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
