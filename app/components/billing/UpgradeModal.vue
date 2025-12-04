<script setup lang="ts">
import { PLANS } from '~~/shared/utils/plans'

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

const selectedInterval = ref<'month' | 'year'>('month')
const loading = ref(false)
const toast = useToast()

// Use shared payment status composable
const { isPaymentFailed: hasPastDueSubscription, hasUsedTrial, organizationId } = usePaymentStatus()

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
  return 'Upgrade to Pro'
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

    // Use Better Auth subscription.upgrade
    // Use no-trial plan if user owns multiple orgs (no trial for 2nd+ org)
    let planId = selectedInterval.value === 'month' ? PLANS.PRO_MONTHLY.id : PLANS.PRO_YEARLY.id
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

        <div class="space-y-2">
          <label class="text-sm font-medium">Select billing cycle:</label>
          <div class="grid grid-cols-1 gap-4">
            <div
              v-for="plan in [PLANS.PRO_MONTHLY, PLANS.PRO_YEARLY]"
              :key="plan.interval"
              class="border rounded-lg p-4 cursor-pointer transition-all"
              :class="selectedInterval === plan.interval ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
              @click="selectedInterval = plan.interval as 'month' | 'year'"
            >
              <div class="flex justify-between items-start mb-2">
                <h3 class="font-semibold">
                  {{ plan.label }}
                </h3>
                <UIcon
                  v-if="selectedInterval === plan.interval"
                  name="i-lucide-check-circle"
                  class="w-5 h-5 text-primary"
                />
                <div
                  v-else
                  class="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600"
                />
              </div>
              <div class="text-2xl font-bold mb-1">
                ${{ plan.priceNumber.toFixed(2) }}
                <span class="text-sm font-normal text-muted-foreground">/ {{ plan.interval }}</span>
              </div>
              <p class="text-xs text-muted-foreground mb-3">
                <span
                  v-if="!hasUsedTrial"
                  class="font-semibold text-green-600 dark:text-green-400"
                >{{ plan.trialDays }}-day free trial<br></span>
                Base Plan (${{ plan.priceNumber.toFixed(2) }}).<br>
                Each additional member adds ${{ (plan.seatPriceNumber || 0).toFixed(2) }}/{{ plan.interval === 'year' ? 'yr' : 'mo' }}.
              </p>

              <div class="space-y-2">
                <ul class="text-xs space-y-1.5 text-muted-foreground">
                  <li
                    v-for="(feature, i) in plan.features"
                    :key="i"
                    class="flex items-center gap-2"
                  >
                    <UIcon
                      name="i-lucide-check"
                      class="w-3 h-3 text-green-500"
                    /> {{ feature }}
                  </li>
                </ul>
              </div>
            </div>
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
        :label="hasUsedTrial ? 'Upgrade to Pro' : 'Start Free Trial'"
        color="primary"
        :loading="loading"
        @click="handleUpgrade"
      />
    </template>
  </UModal>
</template>
