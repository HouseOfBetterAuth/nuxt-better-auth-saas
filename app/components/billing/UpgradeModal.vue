<script setup lang="ts">
import type { PlanInterval, PlanKey } from '~~/shared/utils/plans'
import { getTierForInterval, PLAN_TIERS } from '~~/shared/utils/plans'

const props = defineProps<{
  open: boolean
  reason?: 'invite' | 'create-org'
  organizationId?: string
  teamName?: string
  teamSlug?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'upgraded': []
}>()

const selectedTier = ref<Exclude<PlanKey, 'free'>>('pro')
const selectedInterval = ref<'month' | 'year'>('month')
const loading = ref(false)
const toast = useToast()

// Use shared payment status composable
const { isPaymentFailed: hasPastDueSubscription, hasUsedTrial, organizationId } = usePaymentStatus()

// Get all available tiers sorted by order
const availableTiers = computed(() => {
  return Object.values(PLAN_TIERS).sort((a, b) => a.order - b.order)
})

// Get the selected plan config
const selectedPlanConfig = computed(() => {
  return getTierForInterval(selectedTier.value, selectedInterval.value)
})

// Open billing portal to fix payment
async function openBillingPortal() {
  const orgId = props.organizationId || organizationId.value
  if (!orgId)
    return
  loading.value = true
  try {
    const { url } = await $fetch('/api/stripe/portal', {
      method: 'POST',
      body: { organizationId: orgId }
    })
    if (url) {
      window.location.href = url
    }
  } catch (e) {
    console.error('Failed to open billing portal:', e)
    toast.add({ title: 'Failed to open billing portal', color: 'error' })
  } finally {
    loading.value = false
  }
}

const title = computed(() => {
  return 'Choose Your Plan'
})

const description = computed(() => {
  if (props.reason === 'create-org') {
    return 'Unlock unlimited team members for this organization'
  }
  return 'Each additional team members require an extra seat.'
})

const message = computed(() => {
  if (props.reason === 'create-org') {
    return 'The Free plan only allows 1 organization per user. Each additional organization under the same account require a Pro plan.'
  }
  if (props.reason === 'invite') {
    return 'The Free plan only allows 1 team member. Upgrade this organization to Pro to invite members and unlock additional features.'
  }
  return 'The Free plan only allows 1 organization per user. Upgrade to Pro to unlock additional features for this organization.'
})

async function handleUpgrade() {
  if (!props.organizationId) {
    toast.add({ title: 'No organization found', color: 'error' })
    return
  }

  loading.value = true
  try {
    const { useActiveOrganization, client } = useAuth()
    const activeOrg = useActiveOrganization()
    const orgSlug = activeOrg.value?.data?.slug || props.teamSlug || 't'

    // Use Better Auth subscription.upgrade with selected tier
    let planId = selectedPlanConfig.value.id
    if (hasUsedTrial.value) {
      planId = `${planId}-no-trial`
    }

    await client.subscription.upgrade({
      plan: planId,
      referenceId: props.organizationId,
      metadata: {
        quantity: 1
      },
      successUrl: `${window.location.origin}/${orgSlug}/billing?upgraded=true`,
      cancelUrl: `${window.location.href}`
    })

    emit('upgraded')
  } catch (e: any) {
    toast.add({
      title: 'Failed to start checkout',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="hasPastDueSubscription ? 'Payment Required' : title"
    :description="hasPastDueSubscription ? 'Your subscription has a payment issue' : description"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <!-- Past Due - Show fix payment UI -->
      <div
        v-if="hasPastDueSubscription"
        class="space-y-4"
      >
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div class="flex items-start gap-3">
            <UIcon
              name="i-lucide-alert-triangle"
              class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
            />
            <div>
              <h3 class="font-semibold text-red-800 dark:text-red-200">
                Payment Failed
              </h3>
              <p class="text-sm text-red-700 dark:text-red-300 mt-1">
                Your last payment was declined. Please update your payment method to continue using Pro features.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Normal upgrade UI -->
      <div
        v-else
        class="space-y-4"
      >
        <p class="text-sm text-muted-foreground">
          {{ message }}
        </p>

        <!-- Team Name and Slug (only for create-org) -->
        <div
          v-if="reason === 'create-org' && teamName && teamSlug"
          class="space-y-3 pb-4 border-b border-gray-200 dark:border-gray-700"
        >
          <div>
            <label class="text-sm font-medium">Team Name</label>
            <div class="mt-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2 text-sm">
                <UIcon
                  name="i-lucide-building-2"
                  class="w-4 h-4 text-gray-500"
                />
                <span>{{ teamName }}</span>
              </div>
            </div>
          </div>
          <div>
            <label class="text-sm font-medium">Team URL (Slug)</label>
            <div class="mt-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2 text-sm font-mono">
                <UIcon
                  name="i-lucide-link"
                  class="w-4 h-4 text-gray-500"
                />
                <span>{{ teamSlug }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Billing Interval Toggle -->
        <div class="flex justify-center mb-4">
          <div class="inline-flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              v-for="interval in (['month', 'year'] as PlanInterval[])"
              :key="interval"
              class="relative px-4 py-2 text-sm font-medium rounded-md transition-all"
              :class="selectedInterval === interval
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
              @click="selectedInterval = interval"
            >
              {{ interval === 'month' ? 'Monthly' : 'Yearly' }}
              <span
                v-if="interval === 'year'"
                class="absolute -top-2 -right-2 px-1.5 py-0.5 text-[10px] font-bold bg-green-500 text-white rounded-full"
              >
                Save
              </span>
            </button>
          </div>
        </div>

        <!-- Plan Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="tier in availableTiers"
            :key="tier.key"
            class="relative border rounded-xl p-5 cursor-pointer transition-all"
            :class="[
              selectedTier === tier.key
                ? 'border-primary ring-2 ring-primary bg-primary/5'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
              tier.order === 2 ? 'md:scale-[1.02]' : ''
            ]"
            @click="selectedTier = tier.key as Exclude<PlanKey, 'free'>"
          >
            <!-- Popular Badge -->
            <div
              v-if="tier.order === 2"
              class="absolute -top-3 left-1/2 -translate-x-1/2"
            >
              <span class="px-3 py-1 text-xs font-bold bg-primary text-white rounded-full">
                Most Popular
              </span>
            </div>

            <!-- Header -->
            <div class="flex justify-between items-start mb-3">
              <div>
                <h3 class="font-bold text-lg">
                  {{ tier.name }}
                </h3>
                <p class="text-xs text-muted-foreground">
                  {{ tier.key === 'pro' ? 'For small teams' : 'For growing businesses' }}
                </p>
              </div>
              <UIcon
                v-if="selectedTier === tier.key"
                name="i-lucide-check-circle"
                class="w-6 h-6 text-primary"
              />
              <div
                v-else
                class="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600"
              />
            </div>

            <!-- Price -->
            <div class="mb-4">
              <div class="flex items-baseline gap-1">
                <span class="text-3xl font-bold">
                  ${{ getTierForInterval(tier.key as Exclude<PlanKey, 'free'>, selectedInterval).price.toFixed(2) }}
                </span>
                <span class="text-sm text-muted-foreground">
                  / {{ selectedInterval === 'year' ? 'year' : 'month' }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground mt-1">
                <span
                  v-if="!hasUsedTrial"
                  class="font-semibold text-green-600 dark:text-green-400"
                >{{ tier.trialDays }}-day free trial • </span>
                +${{ getTierForInterval(tier.key as Exclude<PlanKey, 'free'>, selectedInterval).seatPrice.toFixed(2) }}/seat
              </p>
            </div>

            <!-- Features -->
            <ul class="space-y-2">
              <li
                v-for="(feature, i) in tier.features"
                :key="i"
                class="flex items-start gap-2 text-sm"
              >
                <UIcon
                  name="i-lucide-check"
                  class="w-4 h-4 text-green-500 mt-0.5 shrink-0"
                />
                <span class="text-muted-foreground">{{ feature }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        @click="emit('update:open', false)"
      />
      <!-- Past due - show fix payment button -->
      <UButton
        v-if="hasPastDueSubscription"
        label="Update Payment Method"
        color="red"
        icon="i-lucide-credit-card"
        :loading="loading"
        @click="openBillingPortal"
      />
      <!-- Normal upgrade button -->
      <UButton
        v-else
        :label="hasUsedTrial ? `Upgrade to ${PLAN_TIERS[selectedTier].name}` : `Start ${PLAN_TIERS[selectedTier].name} Trial`"
        color="primary"
        :loading="loading"
        @click="handleUpgrade"
      />
    </template>
  </UModal>
</template>
