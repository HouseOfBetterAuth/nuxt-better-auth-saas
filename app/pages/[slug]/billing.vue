<script setup lang="ts">
import type { PlanInterval, PlanKey } from '~~/shared/utils/plans'
import { getPlanKeyFromId, getPlanPricing, getTierForInterval, PLAN_TIERS } from '~~/shared/utils/plans'

const { formatDateShort } = useDate()

definePageMeta({
  layout: 'settings'
})

useHead({
  title: 'Billing'
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Billing')

const { useActiveOrganization, subscription: stripeSubscription, client } = useAuth()
const activeOrg = useActiveOrganization()
const router = useRouter()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const loading = ref(false)
const billingInterval = ref<'month' | 'year'>('month')
const route = useRoute()
const showDowngradeModal = ref(false)
const downgradeData = ref<{ membersToRemove: any[], nextChargeDate: string, legacyWarning?: string | null }>({ membersToRemove: [], nextChargeDate: '' })
const showUpgradeModal = ref(false)
const showTierChangeModal = ref(false)
const tierChangeLoading = ref(false)
const tierChangePreview = ref<any>(null)
const showTierChangePreview = ref(false)
const pendingTierChange = ref<{ tierKey: Exclude<PlanKey, 'free'>, interval: PlanInterval } | null>(null)

// Show upgrade modal if showUpgrade query param is present or if upgrade is needed
const {
  subscriptions,
  activeSub,
  hasUsedTrial: _hasUsedTrial,
  isPaymentFailed,
  refresh: refreshBillingState,
  needsUpgrade
} = usePaymentStatus()

watchEffect(() => {
  if (route.query.showUpgrade === 'true' || needsUpgrade.value) {
    showUpgradeModal.value = true
  }
})

// Handle Stripe success redirect - poll for updated subscription
onMounted(async () => {
  if (route.query.success === 'true') {
    loading.value = true

    // Poll for up to 10 seconds (5 attempts x 2s)
    let attempts = 0
    const maxAttempts = 5
    let foundPro = false

    while (attempts < maxAttempts) {
      // Wait 2s between checks
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log(`Checking for subscription update... (Attempt ${attempts + 1}/${maxAttempts})`)
      await refreshBillingState()

      // Check if we have a Pro subscription now
      const currentSubs = subscriptions.value || []
      const hasPro = currentSubs.some((s: any) => s.status === 'active' || s.status === 'trialing')

      if (hasPro) {
        console.log('Pro subscription found!')
        foundPro = true
        break
      }

      attempts++
    }

    loading.value = false

    // Clear the success param to clean up URL
    const newQuery = { ...route.query }
    delete newQuery.success

    // Handle redirect if present
    const redirectParam = newQuery.redirect as string | undefined
    if (redirectParam) {
      delete newQuery.redirect
      const target = decodeURIComponent(redirectParam)

      // Only allow in-app relative redirects to avoid open-redirects
      if (target.startsWith('/')) {
        router.push(target)
        return
      }
    }

    router.replace({ query: newQuery })

    // Only show success toast if Pro subscription was found
    if (foundPro) {
      toast.add({
        title: 'Subscription updated',
        description: 'Your plan has been successfully updated.',
        color: 'success'
      })
    } else {
      toast.add({
        title: 'Subscription update failed',
        description: 'Unable to verify subscription update. Please check your billing status.',
        color: 'error'
      })
    }
  }
})

// Subscriptions are loaded via usePaymentStatus (backed by Better Auth's Stripe plugin)
const _subscriptions = computed(() => subscriptions.value || [])

// Refresh function for after mutations - re-fetches the whole org data
const refresh = async () => {
  await refreshBillingState()
}

// Sync billingInterval with active subscription
watch(activeSub, (sub) => {
  if (sub) {
    billingInterval.value = sub.plan?.includes('year') ? 'year' : 'month'
  }
}, { immediate: true })

const activePlan = computed(() => {
  return getTierForInterval('pro', billingInterval.value)
})

// Get the current tier key from subscription plan ID
const currentTierKey = computed<PlanKey>(() => {
  if (!activeSub.value?.plan)
    return 'free'
  return getPlanKeyFromId(activeSub.value.plan)
})

// Get current interval from subscription
const currentBillingInterval = computed<PlanInterval>(() => {
  if (!activeSub.value?.plan)
    return 'month'
  return activeSub.value.plan.includes('year') ? 'year' : 'month'
})

// Find the config for the user's actual current plan (handles legacy pricing)
const currentSubPlanConfig = computed(() => {
  if (!activeSub.value?.plan)
    return null
  const pricing = getPlanPricing(activeSub.value.plan)
  if (pricing) {
    return {
      price: pricing.price,
      seatPrice: pricing.seatPrice,
      interval: pricing.interval
    }
  }
  // Fallback to derived current tier pricing
  const fallbackTierKey = (currentTierKey.value === 'free' ? 'pro' : currentTierKey.value) as Exclude<PlanKey, 'free'>
  const fallbackInterval = currentBillingInterval.value
  const fallbackPlan = getTierForInterval(fallbackTierKey, fallbackInterval)
  return {
    price: fallbackPlan.price,
    seatPrice: fallbackPlan.seatPrice,
    interval: fallbackInterval
  }
})

const currentPlan = computed(() => {
  if (activeSub.value) {
    return currentTierKey.value === 'free' ? 'pro' : currentTierKey.value
  }
  return 'free'
})

// Get current plan features from PLAN_TIERS
const currentPlanFeatures = computed<string[]>(() => {
  if (currentTierKey.value === 'free') {
    return ['Up to 5 leads', 'Basic features']
  }
  const tier = PLAN_TIERS[currentTierKey.value as Exclude<PlanKey, 'free'>]
  return tier?.features || []
})

// Handle tier selection - fetch preview first
async function handleTierSelect(newTierKey: Exclude<PlanKey, 'free'>, newInterval: PlanInterval) {
  if (!activeOrg.value?.data?.id)
    return

  tierChangeLoading.value = true
  pendingTierChange.value = { tierKey: newTierKey, interval: newInterval }

  try {
    const preview = await $fetch('/api/stripe/preview-tier-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        newTierKey,
        newInterval
      }
    })

    tierChangePreview.value = preview
    showTierChangeModal.value = false
    showTierChangePreview.value = true
  } catch (e: any) {
    console.error('Preview error:', e)
    toast.add({
      title: 'Error',
      description: e.data?.statusMessage || 'Failed to preview plan change',
      color: 'error'
    })
  } finally {
    tierChangeLoading.value = false
  }
}

// Confirm tier change after preview
async function confirmTierChange() {
  if (!activeOrg.value?.data?.id || !pendingTierChange.value)
    return

  const { tierKey, interval } = pendingTierChange.value
  const tierName = PLAN_TIERS[tierKey]?.name || tierKey

  tierChangeLoading.value = true
  try {
    const result = await $fetch('/api/stripe/change-plan', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        newInterval: interval,
        newTierKey: tierKey
      }
    }) as any

    showTierChangePreview.value = false
    tierChangePreview.value = null
    pendingTierChange.value = null

    if (result.scheduledAt) {
      toast.add({
        title: 'Plan Change Scheduled',
        description: `Your plan will change to ${tierName} on ${new Date(result.scheduledAt).toLocaleDateString()}`,
        color: 'success'
      })
    } else {
      toast.add({
        title: result.isUpgrade ? 'Plan Upgraded!' : 'Plan Changed',
        description: result.isUpgrade
          ? `You've been upgraded to ${tierName}`
          : `Your plan has been changed to ${tierName}`,
        color: 'success'
      })
    }

    // Refresh to get updated subscription
    await refreshBillingState()
  } catch (e: any) {
    console.error('Tier change error:', e)
    toast.add({
      title: 'Error',
      description: e.data?.statusMessage || 'Failed to change plan',
      color: 'error'
    })
  } finally {
    tierChangeLoading.value = false
  }
}

function cancelTierChange() {
  showTierChangePreview.value = false
  tierChangePreview.value = null
  pendingTierChange.value = null
}

// hasUsedTrial comes from usePaymentStatus composable (aliased as _hasUsedTrial above)
const hasUsedTrial = _hasUsedTrial

const isCanceled = computed(() => {
  return activeSub.value?.cancelAtPeriodEnd
})

const trialInfo = computed(() => {
  if (!activeSub.value?.trialEnd)
    return null
  const trialEnd = new Date(activeSub.value.trialEnd)
  const now = new Date()
  const diffTime = trialEnd.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return {
    daysLeft: diffDays > 0 ? diffDays : 0,
    endDate: formatDateShort(trialEnd)
  }
})

const nextChargeDate = computed(() => {
  if (activeSub.value?.periodEnd) {
    return formatDateShort(new Date(activeSub.value.periodEnd))
  }
  return null
})

// Cost breakdown
const costBreakdown = computed(() => {
  if (!activeSub.value) {
    console.log('[billing] costBreakdown: no activeSub')
    return null
  }

  const plan = currentSubPlanConfig.value
  if (!plan) {
    console.log('[billing] costBreakdown: no plan config')
    return null // Added safety check
  }

  const seats = activeSub.value.seats || 1
  const additionalSeats = Math.max(0, seats - 1)

  const baseCost = plan.price
  const seatCost = additionalSeats * plan.seatPrice
  const totalCost = baseCost + seatCost

  return {
    baseCost,
    seatCost,
    seatPrice: plan.seatPrice,
    additionalSeats,
    totalSeats: seats,
    totalCost,
    interval: billingInterval.value
  }
})

// Modal State
const modal = reactive({
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  confirmColor: 'primary',
  loading: false,
  onConfirm: async () => {}
})

function openModal(title: string, message: string, confirmLabel: string, confirmColor: string, onConfirm: () => Promise<void>) {
  modal.title = title
  modal.message = message
  modal.confirmLabel = confirmLabel
  modal.confirmColor = confirmColor
  modal.onConfirm = async () => {
    modal.loading = true
    try {
      await onConfirm()
    } finally {
      modal.loading = false
      modal.isOpen = false
    }
  }
  modal.isOpen = true
}

// Track which tier is being upgraded to (for loading state)
const selectedUpgradeTier = ref<Exclude<PlanKey, 'free'> | null>(null)

async function handleUpgradeWithTier(tierKey: Exclude<PlanKey, 'free'>) {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  selectedUpgradeTier.value = tierKey
  try {
    // Use no-trial plan if user owns multiple orgs
    const selectedPlan = getTierForInterval(tierKey, billingInterval.value)
    let planName = selectedPlan.id
    if (hasUsedTrial.value) {
      planName = `${planName}-no-trial`
    }

    const rawRedirect = route.query.redirect as string | undefined
    const redirectParam = rawRedirect ? `&redirect=${encodeURIComponent(rawRedirect)}` : ''

    const { error } = await stripeSubscription.upgrade({
      plan: planName,
      referenceId: activeOrg.value.data.id,
      successUrl: `${window.location.origin}/${activeOrg.value.data.slug}/billing?success=true${redirectParam}`,
      cancelUrl: `${window.location.origin}/${activeOrg.value.data.slug}/billing?canceled=true${redirectParam}`,
      metadata: {
        organizationId: activeOrg.value.data.id
      }
    })

    if (error) {
      throw error
    }
    // The SDK handles the redirect automatically
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to start checkout: ${e.message || 'Unknown error'}`)
    loading.value = false
    selectedUpgradeTier.value = null
  }
}

async function manageSubscription() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const { data, error } = await stripeSubscription.billingPortal({
      referenceId: activeOrg.value.data.id,
      returnUrl: window.location.href
    })

    if (error) {
      throw error
    }

    if (data?.url) {
      window.location.href = data.url
    }
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to open billing portal: ${e.message || 'Unknown error'}`)
  } finally {
    loading.value = false
  }
}

async function cancelSubscription() {
  if (!activeOrg.value?.data?.id)
    return
  if (!activeSub.value?.stripeSubscriptionId)
    return

  loading.value = true // Show loading while fetching members

  // Refresh subscription data to get latest periodEnd
  await refresh()

  try {
    // Check for member limit (Free plan allows 1 member - the owner)
    const { data: response, error } = await client.organization.listMembers({
      query: {
        organizationId: activeOrg.value.data.id,
        limit: 100 // Fetch enough to cover reasonable teams
      }
    })

    if (error) {
      console.error('Failed to fetch members:', error)
    }

    const membersList = response?.members || []
    console.log('Cancellation Member Check:', { count: membersList.length, members: membersList })

    // Prepare downgrade data
    if (membersList.length > 1) {
      // Sort by createdAt desc (most recent first) to remove newest members
      const sortedMembers = [...membersList].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      downgradeData.value.membersToRemove = sortedMembers.slice(0, membersList.length - 1)
    } else {
      downgradeData.value.membersToRemove = []
    }

    downgradeData.value.nextChargeDate = nextChargeDate.value || 'the end of your billing cycle'
    // Check for legacy pricing warning
    const currentPlanConfig = currentSubPlanConfig.value
    const latestPlanConfig = activePlan.value // This is the V2/current plan

    if (currentPlanConfig && latestPlanConfig && currentPlanConfig.price < latestPlanConfig.price) {
      const currentPrice = `$${currentPlanConfig.price.toFixed(2)}`
      const latestPrice = `$${latestPlanConfig.price.toFixed(2)}`
      downgradeData.value.legacyWarning = `Warning: You are currently on a legacy plan (${currentPrice}). If you downgrade, re-subscribing later will cost the new rate of ${latestPrice}.`
    } else {
      downgradeData.value.legacyWarning = null
    }

    loading.value = false
    showDowngradeModal.value = true
  } catch (e) {
    console.error('Error preparing cancellation:', e)
    loading.value = false
  }
}

async function confirmDowngrade() {
  if (!activeOrg.value?.data?.id || !activeSub.value?.stripeSubscriptionId)
    return

  loading.value = true
  showDowngradeModal.value = false

  try {
    // Use custom API endpoint for cancellation to handle organization-based billing correctly
    await $fetch('/api/stripe/cancel', {
      method: 'POST',
      body: {
        subscriptionId: activeSub.value.stripeSubscriptionId,
        referenceId: activeOrg.value.data.id
      }
    })

    // Refresh subscription data to update UI
    window.location.reload()
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to cancel subscription: ${e.message || 'Unknown error'}`)
  } finally {
    loading.value = false
  }
}

async function resumeSubscription() {
  if (!activeOrg.value?.data?.id)
    return
  if (!activeSub.value?.stripeSubscriptionId)
    return

  const date = nextChargeDate.value || 'the next billing cycle'

  openModal(
    'Resume Subscription',
    `Are you sure you want to resume your subscription? Your plan will renew at no cost to you until the next billing cycle which is ${date}.`,
    'Yes, Resume',
    'primary',
    async () => {
      loading.value = true
      try {
        await $fetch('/api/stripe/resume', {
          method: 'POST',
          body: {
            subscriptionId: activeSub.value!.stripeSubscriptionId,
            referenceId: activeOrg.value!.data!.id
          }
        })

        // Refresh subscription data to update UI
        await refresh()
      } catch (e: any) {
        console.error(e)
        // eslint-disable-next-line no-alert
        alert(`Failed to resume subscription: ${e.message || 'Unknown error'}`)
      } finally {
        loading.value = false
      }
    }
  )
}

const planPreview = ref<any>(null)
const showPlanChangeModal = ref(false)
const newIntervalSelection = ref<'month' | 'year'>('month')

const seatChangePreview = ref<any>(null)
const showSeatChangeModal = ref(false)
const targetSeats = ref(1)

// Invoice history ref for refreshing after changes
const invoiceHistoryRef = ref<{ refresh: () => void } | null>(null)

// Payment error state - shows update payment button in modals
const paymentError = ref(false)

// Billing portal
const portalLoading = ref(false)

async function openBillingPortal() {
  if (!activeOrg.value?.data?.id)
    return

  portalLoading.value = true
  try {
    const { url } = await $fetch('/api/stripe/portal', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        returnUrl: window.location.href
      }
    })
    if (url) {
      window.location.href = url
    }
  } catch (e: any) {
    console.error('Failed to open billing portal:', e)
    toast.add({
      title: 'Failed to open billing portal',
      description: e.data?.message || e.message,
      color: 'error'
    })
  } finally {
    portalLoading.value = false
  }
}

async function initiateSeatChange() {
  if (!activeOrg.value?.data?.id || !activeSub.value)
    return

  const currentSeats = activeSub.value.seats || 1

  // Determine member count to enforce limit
  // We need to fetch members if not available, or rely on client.organization.listMembers if activeOrg.members is missing
  // usage of activeOrg.value.data.members from members.vue suggests it might be populated if hydrated, but here maybe not.
  // Safe to fetch or assume user knows? Better to fetch/check.

  // For now, assume activeOrg.value.data.members might be undefined in billing.vue context if not fetched.
  // Let's quick fetch count to be safe or use existing if available.
  let memberCount = 0
  if (activeOrg.value.data.members) {
    memberCount = activeOrg.value.data.members.length
  } else {
    // Optimistic or fallback?
    // Let's fetch to be safe
    const { data } = await client.organization.listMembers({
      query: { organizationId: activeOrg.value.data.id, limit: 1 }
    })
    if (data?.total)
      memberCount = data.total // listMembers usually returns total
    // Or we can rely on existing 'cancelSubscription' logic which fetches members.
  }

  if (targetSeats.value < memberCount) {
    // eslint-disable-next-line no-alert
    alert(`You cannot reduce seats below your current member count (${memberCount}). Please remove members first.`)
    return
  }

  if (targetSeats.value === currentSeats)
    return

  loading.value = true
  seatChangePreview.value = null

  try {
    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: targetSeats.value
      }
    })
    seatChangePreview.value = preview
    showSeatChangeModal.value = true
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to load preview: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}

async function confirmSeatChange() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true
  try {
    // End trial if user is on trial and adding seats to 2 or more
    const isTrialing = activeSub.value?.status === 'trialing'
    const shouldEndTrial = isTrialing && targetSeats.value >= 2

    await $fetch('/api/stripe/update-seats', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: targetSeats.value,
        endTrial: shouldEndTrial
      }
    })
    showSeatChangeModal.value = false

    // Full reload when ending trial (status changes), otherwise just refresh
    if (shouldEndTrial) {
      window.location.reload()
    } else {
      await refresh()
      // Refresh invoices after a short delay to allow Stripe to process
      setTimeout(() => {
        invoiceHistoryRef.value?.refresh()
      }, 2000)
    }
  } catch (e: any) {
    console.error(e)
    const errorMessage = e.data?.message || e.message || 'Unknown error'
    const isCardError = errorMessage.toLowerCase().includes('card') || errorMessage.toLowerCase().includes('payment') || e.statusCode === 402

    if (isCardError) {
      paymentError.value = true
    }

    toast.add({
      title: isCardError ? 'Payment Failed' : 'Failed to update seats',
      description: isCardError
        ? 'Your card was declined. Please update your payment method and try again.'
        : errorMessage,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// Initialize targetSeats when sub loads
watch(activeSub, (sub) => {
  if (sub)
    targetSeats.value = sub.seats || 1
}, { immediate: true })

async function initiatePlanChange() {
  if (!activeOrg.value?.data?.id || !activeSub.value)
    return

  const isYearly = activeSub.value.plan?.includes('year')
  newIntervalSelection.value = isYearly ? 'month' : 'year'

  // Fetch preview
  loading.value = true
  planPreview.value = null

  try {
    const currentSeats = activeSub.value.seats || 1

    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: currentSeats, // Keep same seats
        newInterval: newIntervalSelection.value
      }
    })

    planPreview.value = preview
    showPlanChangeModal.value = true
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to load plan preview: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}

async function confirmPlanChange() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const res = await $fetch('/api/stripe/change-plan', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        newInterval: newIntervalSelection.value
      }
    })

    if (res.success) {
      showPlanChangeModal.value = false
      await refresh()
      // Refresh invoices after a short delay to allow Stripe to process
      setTimeout(() => {
        invoiceHistoryRef.value?.refresh()
      }, 2000)
    }
  } catch (e: any) {
    console.error(e)
    const errorMessage = e.data?.message || e.message || 'Unknown error'
    const isCardError = errorMessage.toLowerCase().includes('card') || errorMessage.toLowerCase().includes('payment') || e.statusCode === 402

    if (isCardError) {
      paymentError.value = true
    }

    toast.add({
      title: isCardError ? 'Payment Failed' : 'Failed to change plan',
      description: isCardError
        ? 'Your card was declined. Please update your payment method and try again.'
        : errorMessage,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Billing
      </h1>
      <div class="flex gap-2">
        <UButton
          v-if="currentPlan !== 'free'"
          label="Manage Billing"
          color="gray"
          variant="ghost"
          icon="i-lucide-credit-card"
          :loading="loading"
          class="cursor-pointer"
          @click="manageSubscription"
        />
        <UButton
          v-if="currentPlan !== 'free' && !isCanceled"
          label="Downgrade to Free"
          color="red"
          variant="ghost"
          :loading="loading"
          class="cursor-pointer"
          @click="cancelSubscription"
        />
        <UButton
          v-if="currentPlan !== 'free' && isCanceled"
          label="Resume Subscription"
          color="primary"
          variant="solid"
          :loading="loading"
          class="cursor-pointer"
          @click="resumeSubscription"
        />
      </div>
    </div>

    <!-- Current Plan Section -->
    <UCard>
      <div class="flex flex-col gap-6 justify-between">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <h2 class="text-xl font-bold">
              {{ currentPlan === 'free' ? 'Free Plan' : (currentPlan === 'business' ? 'Pro+ Plan' : 'Pro Plan') }}
            </h2>
            <UBadge
              :color="currentPlan !== 'free' ? 'primary' : 'gray'"
              variant="solid"
            >
              Current plan
            </UBadge>
            <UBadge
              v-if="isCanceled"
              color="orange"
              variant="subtle"
            >
              Cancels on {{ nextChargeDate }}
            </UBadge>
            <UBadge
              v-if="activeSub?.status === 'trialing' && trialInfo"
              color="success"
              variant="subtle"
            >
              Trial Active: {{ trialInfo.daysLeft }} days left
            </UBadge>
            <UBadge
              v-if="activeSub?.status === 'past_due'"
              color="error"
              variant="solid"
            >
              Payment Failed
            </UBadge>
          </div>

          <!-- Cost Breakdown -->
          <div
            v-if="costBreakdown"
            class="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg"
          >
            <h3 class="text-sm font-semibold mb-2">
              Current Cost Breakdown
            </h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Base {{ currentPlan === 'business' ? 'Pro+' : 'Pro' }} Plan (includes 1 seat)</span>
                <span class="font-medium">${{ costBreakdown.baseCost.toFixed(2) }}</span>
              </div>
              <div
                v-if="costBreakdown.additionalSeats > 0"
                class="flex justify-between"
              >
                <span class="text-muted-foreground">Additional Seats ({{ costBreakdown.additionalSeats }} × ${{ costBreakdown.seatPrice.toFixed(2) }})</span>
                <span class="font-medium">${{ costBreakdown.seatCost.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                <span class="font-semibold">Total per {{ costBreakdown.interval }}</span>
                <span class="font-bold text-lg">${{ costBreakdown.totalCost.toFixed(2) }}</span>
              </div>
              <div class="text-xs text-muted-foreground pt-1">
                Total seats: {{ costBreakdown.totalSeats }}
              </div>
            </div>
          </div>

          <div
            v-if="currentPlan === 'free'"
            class="text-4xl font-bold mb-1"
          >
            $0 <span class="text-base font-normal text-muted-foreground">/ month</span>
          </div>

          <div
            v-if="activeSub?.status === 'trialing' && trialInfo && costBreakdown"
            class="text-sm text-muted-foreground mt-1"
          >
            Free trial ends on {{ trialInfo.endDate }}. You will be charged ${{ costBreakdown.totalCost.toFixed(2) }} on that date.
          </div>
          <div
            v-else-if="currentPlan !== 'free' && nextChargeDate && !isCanceled"
            class="text-sm text-muted-foreground mt-1"
          >
            Next charge on {{ nextChargeDate }}
          </div>

          <!-- Payment Failed - Show focused fix payment UI -->
          <BillingPaymentFailedCard
            v-if="isPaymentFailed"
            :support-email="runtimeConfig.public.appNotifyEmail"
          />

          <!-- Normal plan management (hide when payment failed) -->
          <template v-if="!isPaymentFailed">
            <!-- Plan Management Buttons -->
            <div
              v-if="currentPlan !== 'free' && !isCanceled"
              class="mt-4 flex flex-wrap gap-2"
            >
              <!-- Switch to Yearly (only for monthly subscribers) -->
              <UButton
                v-if="activeSub?.status !== 'trialing' && !activeSub?.plan?.includes('year')"
                variant="outline"
                size="sm"
                :loading="loading"
                @click="initiatePlanChange"
              >
                Switch to Yearly
              </UButton>

              <!-- Change Plan (upgrade/downgrade tiers) -->
              <UButton
                variant="outline"
                size="sm"
                icon="i-lucide-arrow-up-down"
                @click="showTierChangeModal = true"
              >
                Change Plan
              </UButton>
            </div>

            <!-- Seat Management -->
            <div
              v-if="currentPlan !== 'free' && !isCanceled"
              class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800"
            >
              <h3 class="text-sm font-semibold mb-2">
                Manage Seats
              </h3>
              <div class="flex items-center gap-3">
                <div class="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg">
                  <button
                    class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                    :disabled="targetSeats <= 1"
                    @click="targetSeats--"
                  >
                    -
                  </button>
                  <div class="px-3 py-1 font-medium min-w-[3rem] text-center">
                    {{ targetSeats }}
                  </div>
                  <button
                    class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                    @click="targetSeats++"
                  >
                    +
                  </button>
                </div>
                <UButton
                  size="sm"
                  variant="solid"
                  color="white"
                  :disabled="targetSeats === (activeSub?.seats || 1)"
                  :loading="loading"
                  @click="initiateSeatChange"
                >
                  Update
                </UButton>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                Current seats: {{ activeSub?.seats || 1 }}. Reducing seats below current member count requires removing members first.
              </p>
            </div>

            <!-- Payment Method -->
            <div
              v-if="currentPlan !== 'free'"
              class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800"
            >
              <h3 class="text-sm font-semibold mb-2">
                Payment Method
              </h3>
              <p class="text-xs text-muted-foreground mb-3">
                Update your card, view billing history, or manage your subscription in the Stripe portal.
              </p>
              <UButton
                size="sm"
                variant="outline"
                color="gray"
                icon="i-lucide-credit-card"
                :loading="portalLoading"
                @click="openBillingPortal"
              >
                Manage Payment Method
              </UButton>
            </div>
          </template>
        </div>

        <div class="flex-1">
          <h3 class="font-medium mb-3">
            What's included:
          </h3>
          <div class="grid grid-cols-1 gap-y-2">
            <div
              v-for="feature in currentPlanFeatures"
              :key="feature"
              class="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-amber-500 mt-0.5 shrink-0"
              />
              <span>{{ feature }}</span>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Invoice History (Only show for Pro users) -->
    <UCard v-if="currentPlan !== 'free'">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-receipt"
            class="w-5 h-5 text-muted-foreground"
          />
          <h3 class="text-lg font-semibold">
            Invoice History
          </h3>
        </div>
      </template>

      <LazyBillingInvoiceHistory
        v-if="activeOrg?.data?.id"
        ref="invoiceHistoryRef"
        :organization-id="activeOrg.data.id"
      />
    </UCard>

    <!-- Upgrade Section (Only show if free) -->
    <!-- Upgrade Section - Show all plans -->
    <div
      v-if="currentPlan === 'free'"
      class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 border border-primary/20 p-6"
    >
      <!-- Background decoration -->
      <div class="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

      <div class="relative">
        <!-- Header with toggle -->
        <div class="flex flex-col gap-4 mb-6">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <UIcon
                name="i-lucide-zap"
                class="w-5 h-5 text-primary"
              />
              <span class="text-xs font-semibold text-primary uppercase tracking-wider">Choose Your Plan</span>
            </div>
            <h2 class="text-2xl font-bold">
              Unlock Your Full Potential
            </h2>
          </div>

          <!-- Billing Toggle -->
          <div class="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-full p-1 shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              class="px-4 py-2 text-sm font-medium rounded-full transition-all"
              :class="billingInterval === 'month' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="billingInterval = 'month'"
            >
              Monthly
            </button>
            <button
              class="px-4 py-2 text-sm font-medium rounded-full transition-all relative"
              :class="billingInterval === 'year' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="billingInterval = 'year'"
            >
              Yearly
              <span
                v-if="billingInterval !== 'year'"
                class="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              >
                Save
              </span>
            </button>
          </div>
        </div>

        <!-- Plan Cards Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            v-for="tier in Object.values(PLAN_TIERS).sort((a, b) => a.order - b.order)"
            :key="tier.key"
            class="relative bg-white dark:bg-gray-900 rounded-xl shadow-lg border overflow-hidden transition-all hover:shadow-xl"
            :class="tier.order === 2 ? 'border-primary ring-2 ring-primary' : 'border-gray-200 dark:border-gray-700'"
          >
            <!-- Popular Badge -->
            <div
              v-if="tier.order === 2"
              class="absolute top-0 right-0"
            >
              <div class="bg-primary text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                Most Popular
              </div>
            </div>

            <div class="p-6">
              <!-- Plan Header -->
              <div class="mb-4">
                <h3 class="text-xl font-bold">
                  {{ tier.name }}
                </h3>
                <p class="text-sm text-muted-foreground">
                  {{ tier.key === 'pro' ? 'For small teams' : 'For growing businesses' }}
                </p>
              </div>

              <!-- Price -->
              <div class="mb-4">
                <div class="flex items-baseline gap-1">
                  <span class="text-4xl font-bold">${{ getTierForInterval(tier.key as Exclude<PlanKey, 'free'>, billingInterval).price.toFixed(2) }}</span>
                  <span class="text-muted-foreground">/ {{ billingInterval === 'year' ? 'year' : 'month' }}</span>
                </div>
                <p class="text-sm text-muted-foreground mt-1">
                  + ${{ getTierForInterval(tier.key as Exclude<PlanKey, 'free'>, billingInterval).seatPrice.toFixed(2) }}/seat
                </p>
                <div
                  v-if="!hasUsedTrial"
                  class="flex items-center gap-2 mt-2"
                >
                  <UIcon
                    name="i-lucide-shield-check"
                    class="w-4 h-4 text-amber-500"
                  />
                  <span class="text-xs text-green-600 dark:text-green-400 font-medium">{{ tier.trialDays }}-day free trial</span>
                </div>
              </div>

              <!-- CTA Button -->
              <UButton
                size="lg"
                :label="hasUsedTrial ? `Upgrade to ${tier.name}` : `Start ${tier.name} Trial`"
                :color="tier.order === 2 ? 'primary' : 'neutral'"
                :variant="tier.order === 2 ? 'solid' : 'outline'"
                :loading="loading && selectedUpgradeTier === tier.key"
                class="w-full mb-4"
                @click="handleUpgradeWithTier(tier.key as Exclude<PlanKey, 'free'>)"
              >
                <template #trailing>
                  <UIcon name="i-lucide-arrow-right" />
                </template>
              </UButton>

              <!-- Features -->
              <div class="space-y-2">
                <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  What's included:
                </p>
                <ul class="space-y-2">
                  <li
                    v-for="(feature, i) in tier.features"
                    :key="i"
                    class="flex items-start gap-2 text-sm"
                  >
                    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-primary"
                      />
                    </div>
                    <span>{{ feature }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <UModal
      v-model:open="modal.isOpen"
      :title="modal.title"
      :description="modal.message"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="gray"
          variant="ghost"
          :disabled="modal.loading"
          @click="modal.isOpen = false"
        />
        <UButton
          :label="modal.confirmLabel"
          :color="modal.confirmColor"
          variant="solid"
          :loading="modal.loading"
          @click="modal.onConfirm"
        />
      </template>
    </UModal>

    <!-- Plan Change Modal -->
    <UModal
      v-model:open="showPlanChangeModal"
      :title="`Switch to ${newIntervalSelection === 'month' ? 'Monthly' : 'Yearly'} Plan`"
      :description="newIntervalSelection === 'month'
        ? `You are switching to Monthly billing. This change will take effect at the end of your current billing cycle.`
        : `You are switching to Yearly billing. You will be charged a prorated amount immediately.`"
    >
      <template #body>
        <BillingPlanChangePreview
          v-if="planPreview"
          :seats="activeSub?.seats || 1"
          :current-plan-config="currentSubPlanConfig"
          :new-plan-config="getTierForInterval((currentTierKey === 'free' ? 'pro' : currentTierKey) as Exclude<PlanKey, 'free'>, newIntervalSelection)"
          :new-interval="newIntervalSelection"
          :preview="planPreview"
          :is-trialing="activeSub?.status === 'trialing'"
        />
        <div
          v-else
          class="py-4 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-6 h-6 text-primary"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between w-full">
          <div class="flex gap-2">
            <UButton
              label="Cancel"
              color="gray"
              variant="ghost"
              @click="showPlanChangeModal = false; paymentError = false"
            />
            <UButton
              :label="`Confirm Switch to ${newIntervalSelection === 'month' ? 'Monthly' : 'Yearly'}`"
              color="primary"
              :loading="loading"
              @click="confirmPlanChange"
            />
          </div>
          <UButton
            v-if="paymentError"
            label="Update Payment Method"
            color="orange"
            variant="soft"
            icon="i-lucide-credit-card"
            :loading="portalLoading"
            @click="openBillingPortal"
          />
        </div>
      </template>
    </UModal>

    <!-- Seat Change Modal -->
    <UModal
      v-model:open="showSeatChangeModal"
      title="Update Seat Count"
    >
      <template #body>
        <BillingSeatChangePreview
          v-if="seatChangePreview"
          :current-seats="activeSub?.seats || 1"
          :target-seats="targetSeats"
          :plan-config="currentSubPlanConfig"
          :preview="seatChangePreview"
          :next-charge-date="nextChargeDate"
          :is-trialing="activeSub?.status === 'trialing'"
          show-description
        />
        <div
          v-else
          class="py-4 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-6 h-6 text-primary"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between w-full">
          <div class="flex gap-2">
            <UButton
              label="Cancel"
              color="gray"
              variant="ghost"
              @click="showSeatChangeModal = false; paymentError = false"
            />
            <UButton
              :label="targetSeats > (activeSub?.seats || 1) ? 'Confirm & Pay' : 'Confirm Reduction'"
              color="primary"
              :loading="loading"
              @click="confirmSeatChange"
            />
          </div>
          <UButton
            v-if="paymentError"
            label="Update Payment Method"
            color="orange"
            variant="soft"
            icon="i-lucide-credit-card"
            :loading="portalLoading"
            @click="openBillingPortal"
          />
        </div>
      </template>
    </UModal>

    <!-- Downgrade Confirmation Modal -->
    <UModal
      v-model:open="showDowngradeModal"
      title="Downgrade to Free Plan"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="downgradeData.legacyWarning"
            class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2 items-start"
          >
            <UIcon
              name="i-lucide-trending-up"
              class="w-5 h-5 shrink-0 mt-0.5"
            />
            <span>{{ downgradeData.legacyWarning }}</span>
          </div>

          <p class="text-sm">
            Your subscription will be canceled.
          </p>

          <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div class="flex items-center gap-2 text-sm">
              <UIcon
                name="i-lucide-calendar"
                class="w-4 h-4 text-blue-600 dark:text-blue-400"
              />
              <span class="font-medium">Active Until:</span>
              <span>{{ downgradeData.nextChargeDate }}</span>
            </div>
          </div>

          <div
            v-if="downgradeData.membersToRemove.length > 0"
            class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3"
          >
            <div class="flex items-start gap-2">
              <UIcon
                name="i-lucide-alert-triangle"
                class="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
              />
              <div class="space-y-2 flex-1">
                <p class="font-semibold text-sm text-amber-900 dark:text-amber-100">
                  IMPORTANT
                </p>
                <p class="text-sm text-amber-800 dark:text-amber-200">
                  The Free plan only allows 1 member (you).
                </p>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
                {{ downgradeData.membersToRemove.length }} member{{ downgradeData.membersToRemove.length > 1 ? 's' : '' }} will be removed when your plan downgrades:
              </p>
              <ul class="space-y-1.5 pl-1">
                <li
                  v-for="member in downgradeData.membersToRemove"
                  :key="member.id"
                  class="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
                >
                  <UIcon
                    name="i-lucide-user-minus"
                    class="w-4 h-4 shrink-0"
                  />
                  <span class="font-mono">{{ member.user.email }}</span>
                </li>
              </ul>
            </div>

            <p class="text-xs text-amber-700 dark:text-amber-300 pt-2 border-t border-amber-200 dark:border-amber-700">
              {{ downgradeData.membersToRemove.length > 1 ? 'These users' : 'This user' }} will lose access to this organization on {{ downgradeData.nextChargeDate }}.
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="showDowngradeModal = false"
        />
        <UButton
          label="Yes, Downgrade"
          color="red"
          :loading="loading"
          @click="confirmDowngrade"
        />
      </template>
    </UModal>

    <!-- Upgrade Modal for new teams -->
    <BillingUpgradeModal
      v-model:open="showUpgradeModal"
      :organization-id="activeOrg?.data?.id"
      :team-name="activeOrg?.data?.name"
      :team-slug="activeOrg?.data?.slug"
    />

    <!-- Tier Change Modal (Pro <-> Pro+) -->
    <UModal
      v-model:open="showTierChangeModal"
      title="Change Your Plan"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="relative">
          <BillingTierSelector
            :current-tier-key="currentTierKey"
            :current-interval="currentBillingInterval"
            :is-trialing="activeSub?.status === 'trialing'"
            @select="handleTierSelect"
          />

          <div
            v-if="tierChangeLoading"
            class="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center"
          >
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-loader-2"
                class="w-5 h-5 animate-spin"
              />
              <span>Loading preview...</span>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="showTierChangeModal = false"
        />
      </template>
    </UModal>

    <!-- Tier Change Preview Modal -->
    <UModal
      v-model:open="showTierChangePreview"
      title="Confirm Plan Change"
    >
      <template #body>
        <BillingTierChangePreview
          :preview="tierChangePreview"
          :loading="tierChangeLoading"
          @confirm="confirmTierChange"
          @cancel="cancelTierChange"
        />
      </template>
    </UModal>
  </div>
</template>
