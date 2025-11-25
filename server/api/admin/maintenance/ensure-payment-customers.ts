import { organization as organizationTable } from '~~/server/database/schema'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { ensureStripeCustomer } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const db = await useDB(event)

  // Get all organizations from database
  const organizations = await db.select().from(organizationTable)

  const results = {
    totalOrganizations: organizations.length,
    stripeResults: [] as Array<{ organizationId: string, status: 'success' | 'error', message?: string }>
  }

  // Process each organization
  for (const org of organizations) {
    // Ensure Stripe customer if Stripe is enabled
    if (runtimeConfig.public.payment === 'stripe' && runtimeConfig.stripeSecretKey) {
      if (org.stripeCustomerId) {
        results.stripeResults.push({
          organizationId: org.id,
          status: 'success'
        })
        continue
      }
      try {
        await ensureStripeCustomer(org.id)
        results.stripeResults.push({
          organizationId: org.id,
          status: 'success'
        })
      } catch (error) {
        results.stripeResults.push({
          organizationId: org.id,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  }

  return {
    success: true,
    data: results,
    summary: {
      totalOrganizations: results.totalOrganizations,
      stripeSuccessCount: results.stripeResults.filter(r => r.status === 'success').length,
      stripeErrorCount: results.stripeResults.filter(r => r.status === 'error').length
    }
  }
})
