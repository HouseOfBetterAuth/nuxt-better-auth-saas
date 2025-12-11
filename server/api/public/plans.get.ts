import { FREE_LIMITS, PLAN_TIERS } from '~~/shared/utils/plans'

/**
 * Public API endpoint for fetching plan information
 * No authentication required - for marketing site
 *
 * GET /api/public/plans
 */
export default defineEventHandler(async (event) => {
  // Set cache headers for CDN/browser caching (1 hour)
  setResponseHeaders(event, {
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    'Content-Type': 'application/json'
  })

  // Transform PLAN_TIERS into a public-friendly format
  const plans = Object.entries(PLAN_TIERS).map(([_key, tier]) => ({
    key: tier.key,
    name: tier.name,
    order: tier.order,
    trialDays: tier.trialDays,
    features: tier.features,
    limits: tier.limits,
    pricing: {
      monthly: {
        price: tier.monthly.price,
        seatPrice: tier.monthly.seatPrice
        // Don't expose internal IDs or Stripe price IDs publicly
      },
      yearly: {
        price: tier.yearly.price,
        seatPrice: tier.yearly.seatPrice,
        // Calculate savings percentage
        savingsPercent: tier.monthly.price > 0
          ? Math.max(0, Math.round((1 - (tier.yearly.price / (tier.monthly.price * 12))) * 100))
          : 0
      }
    }
  }))

  // Sort by order
  plans.sort((a, b) => a.order - b.order)

  return {
    plans,
    freeTier: {
      name: 'Free',
      limits: FREE_LIMITS,
      features: [
        'Up to 5 leads',
        'Basic features',
        'WordPress plugin'
      ]
    },
    // Metadata for the marketing site
    meta: {
      currency: 'USD',
      currencySymbol: '$',
      defaultTrialDays: 14,
      includedSeats: 1 // Base plan includes 1 seat
    }
  }
})
