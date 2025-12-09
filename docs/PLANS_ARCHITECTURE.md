# Plans Architecture

This document explains how subscription plans are structured and how to add new tiers.

## Overview

The plans system is centralized in `shared/utils/plans.ts`. All plan definitions, pricing, features, and limits are defined in one place.

## Current Plan Tiers

| Tier | Internal Key | Display Name | Monthly | Yearly |
|------|-------------|--------------|---------|--------|
| Free | `free` | Free | - | - |
| Pro | `pro` | Pro | $29.99/mo + $10/seat | $299.99/yr + $79.99/seat |
| Pro+ | `business` | Pro+ | $79.99/mo + $15/seat | $799.99/yr + $120/seat |

**Legacy (Grandfathered) Pricing:**
| Plan ID | Price | Seat Price |
|---------|-------|------------|
| `pro-monthly-v1` | $19.99/mo | $6.00/seat |
| `pro-yearly-v1` | $199.99/yr | $49.99/seat |

## Database: Subscription `plan` Field

The `subscription.plan` field in your database stores the **plan ID** string. Valid values:

| Plan ID | Tier | Description |
|---------|------|-------------|
| `pro-monthly-v1` | Pro (legacy) | Grandfathered Pro monthly |
| `pro-yearly-v1` | Pro (legacy) | Grandfathered Pro yearly |
| `pro-monthly-v2` | Pro | Current Pro monthly |
| `pro-yearly-v2` | Pro | Current Pro yearly |
| `business-monthly-v1` | Pro+ | Pro+ monthly |
| `business-yearly-v1` | Pro+ | Pro+ yearly |

Add `-no-trial` suffix for subscriptions without trial (2nd+ org):
- `pro-monthly-v2-no-trial`
- `business-yearly-v1-no-trial`

The `-no-trial` suffix is automatically stripped by `normalizePlanId()` for lookups.

## Structure

### Plan Tiers

Each plan tier (e.g., `pro`, `business`) has:
- **Monthly and Yearly variants** with separate Stripe price IDs
- **Features list** for display in UI
- **Limits object** for feature gating

```ts
// Example tier structure
{
  key: 'pro',                    // Unique identifier
  name: 'Pro',                   // Display name
  order: 1,                      // Sort order (higher = more premium)
  monthly: {
    id: 'pro-monthly-v1',        // Internal plan ID
    priceId: 'price_XXX',        // Stripe Price ID
    price: 29.99,
    seatPrice: 6.00
  },
  yearly: {
    id: 'pro-yearly-v1',
    priceId: 'price_YYY',
    price: 299.99,
    seatPrice: 49.99
  },
  trialDays: 14,
  features: ['Feature 1', 'Feature 2'],
  limits: {
    leads: null,                 // null = unlimited
    sms: false,
    stormMaps: false,
    removeBranding: true,
    apiAccess: false
  }
}
```

## Adding a New Plan Tier

### Step 1: Create Stripe Prices

1. Go to Stripe Dashboard → Products
2. Create a new product (e.g., "ProLeadsAI Business")
3. Add two prices:
   - Monthly recurring price
   - Yearly recurring price
4. Copy the `price_XXX` IDs

### Step 2: Update `shared/utils/plans.ts`

Add the new tier to `PLAN_TIERS`:

```ts
export const PLAN_TIERS: Record<PlanKey, PlanTier> = {
  // ... existing tiers ...
  
  business: {
    key: 'business',
    name: 'Business',
    order: 2,
    monthly: {
      id: 'business-monthly-v1',
      priceId: 'price_YOUR_MONTHLY_ID',
      price: 79.99,
      seatPrice: 15.00
    },
    yearly: {
      id: 'business-yearly-v1',
      priceId: 'price_YOUR_YEARLY_ID',
      price: 799.99,
      seatPrice: 120.00
    },
    trialDays: 14,
    features: [
      'Everything in Pro',
      'SMS Lead Notifications',
      'Storm Maps & Alerts',
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
```

Also update the `PlanKey` type:

```ts
export type PlanKey = 'free' | 'pro' | 'business'
```

### Step 3: Register with Better Auth (stripe.ts)

Add the new plans to the subscription config in `server/utils/stripe.ts`:

```ts
// The getSubscriptionPlans() helper auto-generates this from PLAN_TIERS
// No manual changes needed if using the helper
```

### Step 4: Update UI Components (if needed)

The following components auto-iterate over plans:
- `UpgradeModal.vue` - Uses `PAID_TIERS` 
- `billing.vue` - Uses plan helpers

If you need tier-specific UI, use the `getPlanTier()` helper:

```ts
const tier = getPlanTier('business')
if (tier) {
  console.log(tier.name, tier.monthly.price)
}
```

## Helper Functions

### Feature Gating

```ts
import { canAccess, getPlanKeyFromId } from '~~/shared/utils/plans'

// Check if user can access a feature
const userPlanKey = getPlanKeyFromId(subscription.plan) // 'pro'
const hasSMS = canAccess(userPlanKey, 'sms') // false for pro, true for business
```

### Plan Lookups

```ts
import { 
  getPlanTier,
  getPlanById,
  getPlanByPriceId,
  PAID_TIERS,
  ALL_TIERS
} from '~~/shared/utils/plans'

// Get tier by key
const proTier = getPlanTier('pro')

// Get plan config by internal ID
const plan = getPlanById('pro-monthly-v1')

// Get plan config by Stripe price ID  
const plan = getPlanByPriceId('price_XXX')

// Iterate paid plans for UI
PAID_TIERS.forEach(tier => {
  console.log(tier.name, tier.monthly.price)
})
```

## Legacy Plan Support (Price Versioning)

When you change pricing, existing subscribers keep their old price (grandfathering).

### How It Works

1. **Plan IDs include version** - e.g., `pro-monthly-v1`, `pro-monthly-v2`
2. **`LEGACY_PLAN_PRICING`** stores old pricing for display
3. **`getPlanPricing(planId)`** checks legacy first, then current
4. **Stripe handles actual billing** at whatever price they subscribed at

### Example: Raising Pro from $19.99 to $29.99

**Step 1:** Add current v1 pricing to `LEGACY_PLAN_PRICING`:

```ts
export const LEGACY_PLAN_PRICING: Record<string, LegacyPlanPricing> = {
  'pro-monthly-v1': { price: 19.99, seatPrice: 6.00, tierKey: 'pro', interval: 'month' },
  'pro-yearly-v1': { price: 199.99, seatPrice: 49.99, tierKey: 'pro', interval: 'year' },
}
```

**Step 2:** Create new Stripe prices for v2

**Step 3:** Update `PLAN_TIERS.pro` with v2:

```ts
pro: {
  // ...
  monthly: {
    id: 'pro-monthly-v2',           // New ID
    priceId: 'price_NEW_MONTHLY',   // New Stripe price
    price: 29.99,                   // New price
    seatPrice: 10.00
  },
  yearly: {
    id: 'pro-yearly-v2',
    priceId: 'price_NEW_YEARLY',
    price: 299.99,
    seatPrice: 79.99
  },
  // ...
}
```

**Result:**
- Existing `pro-monthly-v1` subscribers see "$19.99/mo" in their billing page
- New subscribers see "$29.99/mo" and get `pro-monthly-v2`
- Stripe continues charging each user at their original price

### Helper Functions

```ts
import { getPlanPricing, isLegacyPlan } from '~~/shared/utils/plans'

// Get correct pricing for a user's plan
const pricing = getPlanPricing(subscription.plan)
// Returns { price: 19.99, seatPrice: 6.00, tierKey: 'pro', interval: 'month' }

// Check if user is on legacy pricing
if (isLegacyPlan(subscription.plan)) {
  // Show "You're on legacy pricing" badge
}
```

## Files That Use Plans

| File | Usage |
|------|-------|
| `shared/utils/plans.ts` | Central plan definitions |
| `server/utils/stripe.ts` | Stripe subscription config |
| `server/api/stripe/change-plan.post.ts` | Plan switching logic |
| `server/api/stripe/preview-seat-change.post.ts` | Pricing calculations |
| `server/api/stripe/update-seats.post.ts` | Seat updates |
| `server/utils/stripeEmails.ts` | Email notifications |
| `app/components/billing/UpgradeModal.vue` | Upgrade UI |
| `app/pages/[slug]/billing.vue` | Billing page |
| `app/components/members/InviteForm.vue` | Seat pricing |
| `server/api/wordpress/settings.ts` | WordPress isPro check |
| `server/api/wordpress/dashboard.ts` | WordPress isPro check |

---

## Changelog: Files Modified in Refactor

### `shared/utils/plans.ts`
**Complete rewrite** - New centralized tier system:
- Added `PlanKey`, `PlanInterval`, `PlanVersion` types
- Added `PlanTier`, `PlanVariant`, `FeatureLimits` interfaces
- Added `PLAN_TIERS` object with tier definitions (currently just `pro`)
- Added `FREE_LIMITS` for free tier feature limits
- Added `LEGACY_PLAN_PRICING` for price versioning support
- Added helper functions:
  - `getTierVariant(tierKey, interval)` - Get variant for tier/interval
  - `getTierForInterval(tierKey, interval)` - Get full plan config
  - `getPlanKeyFromId(planId)` - Extract tier key from plan ID
  - `getPlanPricing(planId)` - Get pricing (checks legacy first)
  - `canAccess(planKey, feature)` - Check feature access
  - `isAtLeastTier(userPlan, requiredTier)` - Compare tier levels
  - `isLegacyPlan(planId)` - Check if on legacy pricing
- **Removed** old `PLANS` object (was `PLANS.PRO_MONTHLY`, `PLANS.PRO_YEARLY`)

### `server/utils/stripe.ts`
- Changed import from `PLANS` to `PLAN_TIERS, PAID_TIERS`
- Refactored `plans` config to dynamically generate from `PAID_TIERS`
- Plans now auto-generate for all tiers (monthly, yearly, no-trial variants)

### `server/api/stripe/change-plan.post.ts`
- Changed import to `PLAN_TIERS, getTierForInterval, getPlanKeyFromId`
- Now fetches local subscription to determine user's current tier
- Uses `getPlanKeyFromId()` to get tier, then `getTierForInterval()` for new price
- Handles tier-aware interval switching (not hardcoded to Pro)

### `server/api/stripe/preview-seat-change.post.ts`
- Changed import to `PLAN_TIERS, getTierForInterval, findPlanById, getPlanKeyFromId`
- Uses `getPlanKeyFromId()` to determine user's tier
- Uses `getTierForInterval()` for pricing calculations
- Supports legacy pricing via `getPlanPricing()`

### `server/api/stripe/update-seats.post.ts`
- Changed import to `getTierForInterval, getPlanKeyFromId`
- Fetches local subscription to determine tier
- Uses tier-aware pricing for interval changes

### `server/utils/stripeEmails.ts`
- Changed import to `findPlanById, findPlanByPriceId, PLAN_TIERS, getPlanPricing`
- Updated `getSubscriptionInfo()` to use new `{ tier, variant, interval }` return format
- Updated `sendTrialStartedEmail()` to use `planInfo?.tier.trialDays`
- Updated `sendSubscriptionResumedEmail()` to use `getPlanPricing()`

### `app/components/billing/UpgradeModal.vue`
- Changed import to `PLAN_TIERS, getTierForInterval, type PlanInterval`
- Uses `getTierForInterval('pro', interval)` instead of `PLANS.PRO_MONTHLY`
- Template iterates over intervals, not hardcoded plan objects
- Uses `PLAN_TIERS.pro.features` and `PLAN_TIERS.pro.trialDays`

### `app/pages/[slug]/billing.vue`
- Changed import to `PLAN_TIERS, getTierForInterval, getPlanPricing, getPlanKeyFromId`
- `activePlan` computed uses `getTierForInterval('pro', interval)`
- `currentSubPlanConfig` uses `getPlanPricing()` for legacy support
- Cost breakdown uses `.price` and `.seatPrice` (not `.priceNumber`)
- `handleUpgrade()` uses `getTierForInterval()`

### `app/components/members/InviteForm.vue`
- Changed import to `PLAN_TIERS, getTierForInterval, getPlanPricing, type PlanInterval`
- `currentSubPlanConfig` uses `getPlanPricing()`
- `getPlanConfigForInterval()` uses `getTierForInterval()`
- Upgrade flow uses `getTierForInterval('pro', interval)`

## Feature Flags by Plan

| Feature | Free | Pro | Pro+ |
|---------|------|-----|------|
| Leads/month | 5 | ∞ | ∞ |
| SMS Notifications | ✗ | ✗ | ✓ |
| Storm Maps | ✗ | ✗ | ✓ |
| Remove Branding | ✗ | ✓ | ✓ |
| API Access | ✗ | ✗ | ✓ |
| Team Members | 1 | ∞ | ∞ |

---

## Detailed Changelog: All Files Modified

### `shared/utils/plans.ts` - Central Plan Definitions

**Complete rewrite** of the plans system.

#### Types Added
```ts
export type PlanKey = 'free' | 'pro' | 'business'
export type PlanVersion = 'v1' | 'v2' | 'v3'
export type PlanInterval = 'month' | 'year'

export interface PlanVariant {
  id: string        // e.g., 'pro-monthly-v2'
  priceId: string   // Stripe price ID
  price: number     // Base price
  seatPrice: number // Per additional seat
}

export interface FeatureLimits {
  leads: number | null  // null = unlimited
  sms: boolean
  stormMaps: boolean
  removeBranding: boolean
  apiAccess: boolean
}

export interface PlanTier {
  key: PlanKey
  name: string           // Display name ('Pro', 'Pro+')
  order: number          // Sort order for tier comparison
  monthly: PlanVariant
  yearly: PlanVariant
  trialDays: number
  features: string[]     // UI feature list
  limits: FeatureLimits
}

export interface LegacyPlanPricing {
  price: number
  seatPrice: number
  tierKey: PlanKey
  interval: PlanInterval
  limits?: Partial<FeatureLimits>  // Optional limit overrides
}
```

#### Constants Added
- `PLAN_TIERS` - Main tier definitions (pro, business)
- `FREE_LIMITS` - Feature limits for free tier
- `LEGACY_PLAN_PRICING` - Grandfathered pricing for old plan IDs
- `PAID_TIERS` - Array of paid tiers sorted by order

#### Helper Functions Added
| Function | Purpose |
|----------|---------|
| `normalizePlanId(planId)` | Strips `-no-trial` suffix |
| `getPlanKeyFromId(planId)` | Extracts tier key from plan ID (checks legacy first) |
| `getTierVariant(tierKey, interval)` | Gets variant (monthly/yearly) for a tier |
| `getTierForInterval(tierKey, interval)` | Gets full plan config with all fields |
| `getPlanTier(key)` | Gets tier by key |
| `findPlanById(planId)` | Finds plan by ID, returns `{ tier, variant, interval }` |
| `findPlanByPriceId(priceId)` | Finds plan by Stripe price ID |
| `getPlanPricing(planId)` | Gets pricing (checks legacy first, then current) |
| `isLegacyPlan(planId)` | Checks if plan ID is in legacy pricing |
| `canAccess(planKey, feature)` | Checks feature access by tier key |
| `getPlanLimits(planId)` | Gets limits for specific plan ID (with legacy overrides) |
| `canAccessFeature(planId, feature)` | Checks feature access by plan ID |
| `isAtLeastTier(userPlan, requiredTier)` | Compares tier levels |

#### What Was Removed
- Old `PLANS` object (`PLANS.PRO_MONTHLY`, `PLANS.PRO_YEARLY`)
- Old property names (`priceNumber`, `seatPriceNumber`) → now `price`, `seatPrice`

---

### `server/utils/stripe.ts` - Stripe Configuration

**Changes:**
- Import changed from `PLANS` to `PLAN_TIERS, PAID_TIERS`
- `plans` config now **dynamically generated** from `PAID_TIERS`:

```ts
plans: async () => {
  const plans: any[] = []
  for (const tier of PAID_TIERS) {
    // Monthly with trial
    plans.push({
      name: tier.monthly.id,
      priceId: tier.monthly.priceId,
      freeTrial: { days: tier.trialDays, ... }
    })
    // Yearly with trial
    plans.push({
      name: tier.yearly.id,
      priceId: tier.yearly.priceId,
      freeTrial: { days: tier.trialDays, ... }
    })
    // No-trial versions
    plans.push({ name: `${tier.monthly.id}-no-trial`, priceId: tier.monthly.priceId })
    plans.push({ name: `${tier.yearly.id}-no-trial`, priceId: tier.yearly.priceId })
  }
  return plans
}
```

**Benefit:** Adding a new tier to `PLAN_TIERS` automatically registers it with Stripe.

---

### `server/api/stripe/change-plan.post.ts` - Plan Interval Switching

**Changes:**
- Import: `PLAN_TIERS, getTierForInterval, getPlanKeyFromId`
- Now fetches local subscription to determine user's **current tier**
- Uses `getPlanKeyFromId(localSub?.plan)` to get tier
- Uses `getTierForInterval(tierKey, newInterval)` to get new price ID
- Updates `subscription.plan` to new plan ID (e.g., `pro-yearly-v2`)

**Before:** Hardcoded `PLANS.PRO_YEARLY.priceId`
**After:** Tier-aware: `getTierForInterval(currentTierKey, 'year').priceId`

---

### `server/api/stripe/preview-seat-change.post.ts` - Seat Change Preview

**Changes:**
- Import: `PLAN_TIERS, getTierForInterval, findPlanById, getPlanKeyFromId`
- Trial case: Uses `getPlanKeyFromId()` and `getTierForInterval()` for pricing
- Active case: Same tier-aware pricing lookup
- **Added:** Payment method info in response:

```ts
// Get payment method info
let paymentMethod = null
if (subscription.default_payment_method) {
  const pm = await stripe.paymentMethods.retrieve(...)
  if (pm.card) {
    paymentMethod = {
      type: 'card',
      brand: pm.card.brand,      // 'visa', 'mastercard'
      last4: pm.card.last4,      // '4242'
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year
    }
  }
}
```

---

### `server/api/stripe/update-seats.post.ts` - Seat Updates

**Changes:**
- Import: `getTierForInterval, getPlanKeyFromId`
- Fetches local subscription to determine tier
- Uses tier-aware pricing for interval changes

---

### `server/utils/stripeEmails.ts` - Email Notifications

**Changes:**
- Import: `findPlanById, findPlanByPriceId, PLAN_TIERS, getPlanPricing`
- `getSubscriptionInfo()`:
  - Uses `planResult?.tier.name` for plan name (shows "Pro" or "Pro+")
  - Uses `planResult?.variant.price` for pricing
- `sendTrialStartedEmail()`: Uses `planInfo?.tier.trialDays`
- `sendSubscriptionResumedEmail()`: Uses `getPlanPricing()` for correct pricing

**Result:** Emails show correct plan name and pricing for all tiers including legacy.

---

### `app/components/billing/UpgradeModal.vue` - Upgrade Modal

**Changes:**
- Import: `PLAN_TIERS, getTierForInterval, type PlanInterval`
- Plan selection: `getTierForInterval('pro', selectedInterval.value)`
- Template iterates over intervals `['month', 'year']`, not hardcoded plans
- Uses `PLAN_TIERS.pro.features` and `PLAN_TIERS.pro.trialDays`

---

### `app/pages/[slug]/billing.vue` - Billing Page

**Changes:**
- Import: `PLAN_TIERS, getTierForInterval, getPlanPricing, getPlanKeyFromId`
- `activePlan`: `getTierForInterval('pro', billingInterval.value)`
- `currentSubPlanConfig`: Uses `getPlanPricing(activeSub.value.plan)` for legacy support
- Cost breakdown: Uses `.price` and `.seatPrice` (not old `.priceNumber`)
- `handleUpgrade()`: Uses `getTierForInterval()`
- Plan change modal: Uses `getTierForInterval('pro', newIntervalSelection)`

---

### `app/components/billing/PlanChangePreview.vue` - Plan Switch Preview

**Changes:**
- Interface `PlanConfig`: Changed `priceNumber`/`seatPriceNumber` → `price`/`seatPrice`
- Added `PaymentMethod` interface for card display
- Added `cardBrandDisplay` and `cardIcon` computed properties
- Template shows: "Your Visa ending in 4242 will be charged immediately"

---

### `app/components/billing/SeatChangePreview.vue` - Seat Change Preview

**Changes:**
- Interface `PlanConfig`: Changed `priceNumber`/`seatPriceNumber` → `price`/`seatPrice`
- Added `PaymentMethod` interface
- Added card display computed properties
- Template shows payment method info

---

### `app/components/members/InviteForm.vue` - Member Invite Form

**Changes:**
- Import: `PLAN_TIERS, getTierForInterval, getPlanPricing, type PlanInterval`
- `currentSubPlanConfig`: Uses `getPlanPricing()`
- `getPlanConfigForInterval()`: Uses `getTierForInterval()`
- Upgrade flow: Uses `getTierForInterval('pro', seatInterval.value)`

---

## Legacy Plan Limits

Legacy plans can have **different feature limits** than current plans:

```ts
export const LEGACY_PLAN_PRICING: Record<string, LegacyPlanPricing> = {
  'pro-monthly-v1': { 
    price: 19.99, 
    seatPrice: 6.00, 
    tierKey: 'pro', 
    interval: 'month',
    limits: { sms: true }  // V1 had SMS, V2 doesn't
  },
}
```

Use `getPlanLimits(planId)` or `canAccessFeature(planId, feature)` to check:

```ts
// Checks legacy overrides first, then falls back to tier limits
const limits = getPlanLimits('pro-monthly-v1')
// { leads: null, sms: true, ... } - has SMS override

const limits2 = getPlanLimits('pro-monthly-v2')
// { leads: null, sms: false, ... } - uses current tier limits
```

---

## Enforcing Feature Limits

Example enforcement patterns (not yet implemented):

```ts
// In API endpoint
import { canAccessFeature, getPlanLimits } from '~~/shared/utils/plans'

// Boolean feature check
if (!canAccessFeature(subscription.plan, 'sms')) {
  throw createError({ statusCode: 403, message: 'SMS requires Pro+ plan' })
}

// Numeric limit check
const limits = getPlanLimits(subscription.plan)
if (limits.leads !== null && currentLeadCount >= limits.leads) {
  throw createError({ statusCode: 403, message: 'Lead limit reached' })
}

// Middleware pattern
export function requireFeature(feature: keyof FeatureLimits) {
  return async (event: H3Event) => {
    const subscription = await getSubscription(event)
    if (!canAccessFeature(subscription?.plan, feature)) {
      throw createError({ statusCode: 403, message: 'Upgrade required' })
    }
  }
}
```

---

## Discounts & Coupons

**As of December 2024, all discount/coupon logic has been removed from this codebase.**

This application does not support coupons or discounts. All pricing is shown at full price. The `discounts: []` parameter is passed to Stripe's preview API to ensure accurate proration calculations.

### Files Changed (Discount Removal)

| File | Changes |
|------|---------|
| `server/api/stripe/subscription-info.get.ts` | **Deleted** |
| `server/api/stripe/preview-seat-change.post.ts` | Passes `discounts: []` to preview |
| `server/api/stripe/preview-tier-change.post.ts` | Removed discount from response |
| `app/pages/[slug]/billing.vue` | Removed discount display and imports |
| `app/components/billing/SeatChangePreview.vue` | Removed discount logic |
| `app/components/billing/TierChangePreview.vue` | Removed discount interface |
| `app/components/billing/PlanChangePreview.vue` | Removed discount interface |
