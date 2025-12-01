export const PLANS = {
  // --- LEGACY PLANS (Matches your existing Database & Stripe IDs) ---
  // This must come FIRST so existing users match this config ($14.99)
  PRO_MONTHLY_V1: {
    id: 'pro-monthly-v1',
    priceId: 'price_1SX5xDQ0QR4mh9DyXZwG1wjc',
    key: 'pro',
    interval: 'month',
    label: 'Monthly (Legacy)',
    priceNumber: 14.99,
    seatPriceNumber: 5.00,
    description: 'Billed monthly',
    trialDays: 14,
    features: [
      'Full CRM Access & Rich Data',
      'In-app Estimate Runner',
      'Standalone Usage (No WP needed)',
      'Unlimited Team Members',
      'Priority Support'
    ]
  },
  PRO_YEARLY_V1: {
    id: 'pro-yearly-v1',
    priceId: 'price_1SXDCLQ0QR4mh9Dyev8P5wuM',
    key: 'pro',
    interval: 'year',
    label: 'Yearly (Legacy)',
    priceNumber: 99.99,
    seatPriceNumber: 50.00,
    description: 'Billed yearly (Save ~45%)',
    trialDays: 14,
    features: [
      'Full CRM Access & Rich Data',
      'In-app Estimate Runner',
      'Standalone Usage (No WP needed)',
      'Unlimited Team Members',
      'Priority Support'
    ]
  },

  // --- CURRENT PLANS (New Upgrades) ---
  // You MUST create new prices in stripe for this to work!
  PRO_MONTHLY: {
    id: 'pro-monthly-v2',
    priceId: 'price_1SXxxVQ0QR4mh9DyqUQ5jO2u',
    key: 'pro',
    interval: 'month',
    label: 'Monthly',
    priceNumber: 11.99,
    seatPriceNumber: 5.99,
    description: 'Billed monthly',
    trialDays: 14,
    features: [
      'Full CRM Access & Rich Data',
      'In-app Estimate Runner',
      'Standalone Usage (No WP needed)',
      'Unlimited Team Members',
      'Priority Support'
    ]
  },
  PRO_YEARLY: {
    id: 'pro-yearly-v2',
    priceId: 'price_1SXxywQ0QR4mh9DyTg8bJLZc',
    key: 'pro',
    interval: 'year',
    label: 'Yearly',
    priceNumber: 229.99,
    seatPriceNumber: 44.44,
    description: 'Billed yearly (Save ~45%)',
    trialDays: 14,
    features: [
      'Full CRM Access & Rich Data',
      'In-app Estimate Runner',
      'Standalone Usage (No WP needed)',
      'Unlimited Team Members',
      'Priority Support'
    ]
  }
}

/**
 * Normalize a plan ID by removing the -no-trial suffix
 * This ensures consistent plan lookups regardless of how the subscription was created
 */
export function normalizePlanId(planId: string | null | undefined): string | null {
  if (!planId)
    return null
  return planId.replace('-no-trial', '')
}

/**
 * Find a plan by ID (handles -no-trial suffix automatically)
 */
export function findPlanById(planId: string | null | undefined): typeof PLANS[keyof typeof PLANS] | undefined {
  const normalizedId = normalizePlanId(planId)
  return Object.values(PLANS).find(p => p.id === normalizedId)
}

/**
 * Find a plan by price ID
 */
export function findPlanByPriceId(priceId: string | null | undefined): typeof PLANS[keyof typeof PLANS] | undefined {
  if (!priceId)
    return undefined
  return Object.values(PLANS).find(p => p.priceId === priceId)
}
