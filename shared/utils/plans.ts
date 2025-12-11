// =============================================================================
// PLAN TIER SYSTEM
// =============================================================================
// Centralized plan definitions. To add a new tier:
// 1. Add Stripe prices (monthly + yearly)
// 2. Add tier to PLAN_TIERS below
// 3. Update PlanKey type
// See docs/PLANS_ARCHITECTURE.md for full guide
// =============================================================================

export type PlanKey = 'free' | 'pro' | 'business'

export type PlanVersion = 'v1' | 'v2' | 'v3' // Add new versions as needed

export type PlanInterval = 'month' | 'year'

export interface PlanVariant {
  id: string
  priceId: string
  price: number
  seatPrice: number
}

export interface FeatureLimits {
  leads: number | null // null = unlimited
  sms: boolean
  stormMaps: boolean
  removeBranding: boolean
  apiAccess: boolean
}

export interface PlanTier {
  key: PlanKey
  name: string
  order: number // Higher = more premium (for sorting)
  monthly: PlanVariant
  yearly: PlanVariant
  trialDays: number
  features: string[]
  limits: FeatureLimits
}

// =============================================================================
// PLAN TIER DEFINITIONS
// =============================================================================

export const PLAN_TIERS: Record<Exclude<PlanKey, 'free'>, PlanTier> = {
  pro: {
    key: 'pro',
    name: 'Pro',
    order: 1,
    monthly: {
      id: 'pro-monthly-v1',
      priceId: 'price_1ScBNpL7TP83v94rcrAseP5W',
      price: 29.99,
      seatPrice: 10.00
    },
    yearly: {
      id: 'pro-yearly-v1',
      priceId: 'price_1ScBOeL7TP83v94r6u2nAY8y',
      price: 299.99,
      seatPrice: 79.99
    },
    trialDays: 14,
    features: [
      'Full CRM Access & Rich Data',
      'In-app Estimate Runner',
      'Standalone Usage (No WP needed)',
      'Unlimited Team Members',
      'Priority Support'
    ],
    limits: {
      leads: null,
      sms: false,
      stormMaps: false,
      removeBranding: true,
      apiAccess: false
    }
  },
  business: {
    key: 'business',
    name: 'Pro+',
    order: 2,
    monthly: {
      id: 'business-monthly-v1',
      priceId: 'price_1ScBQXL7TP83v94rUCUJhtJT',
      price: 79.99,
      seatPrice: 15.00
    },
    yearly: {
      id: 'business-yearly-v1',
      priceId: 'price_1ScBRML7TP83v94rYj307O9X', // TODO: Create separate yearly price in Stripe
      price: 799.99,
      seatPrice: 120.00
    },
    trialDays: 14,
    features: [
      'Everything in Pro',
      'SMS Notifications',
      'Storm Maps',
      'API Access',
      'Priority Support'
    ],
    limits: {
      leads: null,
      sms: true,
      stormMaps: true,
      removeBranding: true,
      apiAccess: true
    }
  }
}

// Free tier limits (not in PLAN_TIERS since it's not purchasable)
export const FREE_LIMITS: FeatureLimits = {
  leads: 5,
  sms: false,
  stormMaps: false,
  removeBranding: false,
  apiAccess: false
}

// =============================================================================
// LEGACY PLAN VERSIONS
// =============================================================================
// When you change pricing, add the OLD plan here before updating PLAN_TIERS.
// This preserves pricing display for existing subscribers.
// Key format: 'planId' (e.g., 'pro-monthly-v1')
//
// Example: If Pro was $14.99 and you're raising to $19.99:
// 1. Add current v1 to LEGACY_PLAN_PRICING below
// 2. Update PLAN_TIERS with new v2 prices and IDs
// 3. Existing 'pro-monthly-v1' users see $14.99, new users see $19.99

export interface LegacyPlanPricing {
  price: number
  seatPrice: number
  tierKey: PlanKey
  interval: PlanInterval
  limits?: Partial<FeatureLimits> // Optional: override limits for this legacy plan
}

export const LEGACY_PLAN_PRICING: Record<string, LegacyPlanPricing> = {
  // Add legacy plans here when you change pricing
  // Example: 'pro-monthly-v1': { price: 19.99, seatPrice: 6.00, tierKey: 'pro', interval: 'month' },
}

// =============================================================================
// HELPER: Get plan variant for interval
// =============================================================================

export function getTierVariant(tierKey: Exclude<PlanKey, 'free'>, interval: PlanInterval): PlanVariant {
  const variantKey = interval === 'month' ? 'monthly' : 'yearly'
  return PLAN_TIERS[tierKey][variantKey]
}

export function getTierForInterval(tierKey: Exclude<PlanKey, 'free'>, interval: PlanInterval) {
  const tier = PLAN_TIERS[tierKey]
  const variantKey = interval === 'month' ? 'monthly' : 'yearly'

  if (!tier) {
    console.error(`[getTierForInterval] Tier '${tierKey}' not found in PLAN_TIERS. Available tiers:`, Object.keys(PLAN_TIERS))
    // Fallback to 'pro' if tier not found
    const fallbackTier = PLAN_TIERS.pro
    const variant = fallbackTier[variantKey]
    return {
      id: variant.id,
      priceId: variant.priceId,
      key: fallbackTier.key,
      interval,
      label: interval === 'month' ? 'Monthly' : 'Yearly',
      price: variant.price,
      seatPrice: variant.seatPrice,
      trialDays: fallbackTier.trialDays,
      features: fallbackTier.features,
      limits: fallbackTier.limits
    }
  }
  const variant = tier[variantKey]
  return {
    id: variant.id,
    priceId: variant.priceId,
    key: tier.key,
    interval,
    label: interval === 'month' ? 'Monthly' : 'Yearly',
    price: variant.price,
    seatPrice: variant.seatPrice,
    trialDays: tier.trialDays,
    features: tier.features,
    limits: tier.limits
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** Get all paid tiers sorted by order */
export const PAID_TIERS = Object.values(PLAN_TIERS).sort((a, b) => a.order - b.order)

/** Get all tier keys including free */
export const ALL_PLAN_KEYS: PlanKey[] = ['free', ...PAID_TIERS.map(t => t.key)]

/**
 * Normalize a plan ID by removing the -no-trial suffix
 */
export function normalizePlanId(planId: string | null | undefined): string | null {
  if (!planId)
    return null
  return planId.replace('-no-trial', '')
}

/**
 * Get plan key from a plan ID (e.g., 'pro-monthly-v1' -> 'pro')
 * Checks legacy plans first, then current PLAN_TIERS
 */
export function getPlanKeyFromId(planId: string | null | undefined): PlanKey {
  if (!planId)
    return 'free'
  const normalizedId = normalizePlanId(planId)
  if (!normalizedId)
    return 'free'

  // Check legacy plans first (for old plan IDs after price changes)
  const legacy = LEGACY_PLAN_PRICING[normalizedId]
  if (legacy) {
    return legacy.tierKey
  }

  // Check current PLAN_TIERS
  for (const tier of Object.values(PLAN_TIERS)) {
    if (tier.monthly.id === normalizedId || tier.yearly.id === normalizedId) {
      return tier.key
    }
  }

  // Fallback: try to extract tier from plan ID pattern (e.g., 'pro-monthly-v1' -> 'pro')
  const match = normalizedId.match(/^([a-z]+)-(?:monthly|yearly)-v\d+$/)
  if (match && match[1]) {
    const possibleTier = match[1] as PlanKey
    if (possibleTier in PLAN_TIERS || possibleTier === 'free') {
      return possibleTier
    }
  }

  return 'free'
}

/**
 * Get a plan tier by key
 */
export function getPlanTier(key: PlanKey): PlanTier | undefined {
  if (key === 'free')
    return undefined
  return PLAN_TIERS[key as Exclude<PlanKey, 'free'>]
}

/**
 * Check if a plan has access to a feature
 */
export function canAccess(planKey: PlanKey, feature: keyof FeatureLimits): boolean | number | null {
  if (planKey === 'free') {
    return FREE_LIMITS[feature]
  }
  const tier = PLAN_TIERS[planKey as Exclude<PlanKey, 'free'>]
  return tier?.limits[feature] ?? FREE_LIMITS[feature]
}

/**
 * Get limits for a specific plan ID (checks legacy overrides first)
 * Use this when you need to check what features a specific subscriber has access to
 */
export function getPlanLimits(planId: string | null | undefined): FeatureLimits {
  const normalizedId = normalizePlanId(planId)
  if (!normalizedId) {
    return FREE_LIMITS
  }

  // Check legacy plan for limit overrides
  const legacy = LEGACY_PLAN_PRICING[normalizedId]
  if (legacy) {
    const baseTier = PLAN_TIERS[legacy.tierKey as Exclude<PlanKey, 'free'>]
    if (baseTier) {
      // Merge base tier limits with legacy overrides
      return {
        ...baseTier.limits,
        ...legacy.limits
      }
    }
  }

  // Get limits from current tier
  const tierKey = getPlanKeyFromId(normalizedId)
  if (tierKey === 'free') {
    return FREE_LIMITS
  }

  const tier = PLAN_TIERS[tierKey as Exclude<PlanKey, 'free'>]
  return tier?.limits ?? FREE_LIMITS
}

/**
 * Check if a specific plan ID has access to a feature (checks legacy overrides)
 */
export function canAccessFeature(planId: string | null | undefined, feature: keyof FeatureLimits): boolean | number | null {
  const limits = getPlanLimits(planId)
  return limits[feature]
}

/**
 * Check if plan is at least a certain tier
 */
export function isAtLeastTier(userPlanKey: PlanKey, requiredTierKey: PlanKey): boolean {
  if (requiredTierKey === 'free')
    return true
  if (userPlanKey === 'free')
    return false

  const userTier = PLAN_TIERS[userPlanKey as Exclude<PlanKey, 'free'>]
  const requiredTier = PLAN_TIERS[requiredTierKey as Exclude<PlanKey, 'free'>]

  if (!userTier || !requiredTier)
    return false
  return userTier.order >= requiredTier.order
}

/**
 * Find a plan by ID (handles -no-trial suffix automatically)
 * Returns { tier, variant, interval } or undefined
 */
export function findPlanById(planId: string | null | undefined) {
  return getPlanVariantById(planId)
}

/**
 * Get pricing for a plan ID, checking legacy pricing first
 * Use this for displaying costs to existing subscribers
 */
export function getPlanPricing(planId: string | null | undefined): { price: number, seatPrice: number, tierKey: PlanKey, interval: PlanInterval } | undefined {
  const normalizedId = normalizePlanId(planId)
  if (!normalizedId)
    return undefined

  // Check legacy pricing first (for grandfathered users)
  const legacy = LEGACY_PLAN_PRICING[normalizedId]
  if (legacy) {
    return legacy
  }

  // Fall back to current tier pricing
  const variant = getPlanVariantById(normalizedId)
  if (variant) {
    return {
      price: variant.variant.price,
      seatPrice: variant.variant.seatPrice,
      tierKey: variant.tier.key,
      interval: variant.interval
    }
  }

  return undefined
}

/**
 * Check if a plan ID is a legacy/grandfathered plan
 */
export function isLegacyPlan(planId: string | null | undefined): boolean {
  const normalizedId = normalizePlanId(planId)
  if (!normalizedId)
    return false
  return normalizedId in LEGACY_PLAN_PRICING
}

/**
 * Find a plan by Stripe price ID
 * Returns { tier, variant, interval } or undefined
 */
export function findPlanByPriceId(priceId: string | null | undefined): { tier: PlanTier, variant: PlanVariant, interval: PlanInterval } | undefined {
  if (!priceId)
    return undefined
  for (const tier of Object.values(PLAN_TIERS)) {
    if (tier.monthly.priceId === priceId) {
      return { tier, variant: tier.monthly, interval: 'month' }
    }
    if (tier.yearly.priceId === priceId) {
      return { tier, variant: tier.yearly, interval: 'year' }
    }
  }
  return undefined
}

/**
 * Get plan variant (monthly/yearly) by plan ID
 */
export function getPlanVariantById(planId: string | null | undefined): { tier: PlanTier, variant: PlanVariant, interval: PlanInterval } | undefined {
  const normalizedId = normalizePlanId(planId)
  if (!normalizedId)
    return undefined

  for (const tier of Object.values(PLAN_TIERS)) {
    if (tier.monthly.id === normalizedId) {
      return { tier, variant: tier.monthly, interval: 'month' }
    }
    if (tier.yearly.id === normalizedId) {
      return { tier, variant: tier.yearly, interval: 'year' }
    }
  }
  return undefined
}

/**
 * Get plan variant by Stripe price ID
 */
export function getPlanByStripePriceId(priceId: string | null | undefined): { tier: PlanTier, tierKey: PlanKey, variant: PlanVariant, interval: PlanInterval } | undefined {
  if (!priceId)
    return undefined

  for (const [tierKey, tier] of Object.entries(PLAN_TIERS)) {
    if (tier.monthly.priceId === priceId) {
      return { tier, tierKey: tierKey as PlanKey, variant: tier.monthly, interval: 'month' }
    }
    if (tier.yearly.priceId === priceId) {
      return { tier, tierKey: tierKey as PlanKey, variant: tier.yearly, interval: 'year' }
    }
  }
  return undefined
}
