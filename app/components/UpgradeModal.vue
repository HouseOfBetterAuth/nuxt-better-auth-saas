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

const { client, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const selectedInterval = ref<'month' | 'year'>('month')
const loading = ref(false)
const toast = useToast()

const title = computed(() => {
  return 'Upgrade to Pro'
})

const description = computed(() => {
  if (props.reason === 'create-org') {
    return 'Unlock unlimited team members for this organization'
  }
  return 'Invite unlimited team members with a Pro plan'
})

const message = computed(() => {
  if (props.reason === 'create-org') {
    return 'The Free plan only allows 1 organization per user. Each additional organization under the same account requires a Pro plan.'
  }
  if (props.reason === 'invite') {
    return 'The Free plan only allows 1 team member. Upgrade this organization to Pro to invite members and unlock additional features.'
  }
  return 'The Free plan only allows 1 organization per user. Upgrade to Pro to create unlimited organizations and unlock additional features.'
})

function getOrgSlug() {
  return props.teamSlug || activeOrg.value?.data?.slug || null
}

function handleMissingSlug() {
  console.error('[UpgradeModal] Missing organization slug for upgrade redirect', {
    teamSlug: props.teamSlug
  })
  toast.add({
    title: 'Missing organization slug',
    description: 'Unable to determine the organization URL for checkout. Please try again.',
    color: 'error'
  })
}

function setSelectedInterval(interval: string) {
  if (interval === 'month' || interval === 'year') {
    selectedInterval.value = interval
  } else {
    console.warn('[UpgradeModal] Ignoring unsupported interval', interval)
  }
}

async function handleUpgrade() {
  if (!props.organizationId) {
    toast.add({ title: 'No organization found', color: 'error' })
    return
  }

  loading.value = true
  try {
    const orgSlug = getOrgSlug()

    if (!orgSlug) {
      handleMissingSlug()
      return
    }

    // Use Better Auth subscription.upgrade
    await client.subscription.upgrade({
      plan: selectedInterval.value === 'month' ? 'pro-monthly' : 'pro-yearly',
      referenceId: props.organizationId,
      metadata: {
        quantity: 1
      },
      successUrl: `${window.location.origin}/${orgSlug}/dashboard?upgraded=true`,
      cancelUrl: `${window.location.origin}/${orgSlug}/dashboard?canceled=true`
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
    :title="title"
    :description="description"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
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
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="plan in [PLANS.PRO_MONTHLY, PLANS.PRO_YEARLY]"
              :key="plan.interval"
              class="border rounded-lg p-4 cursor-pointer transition-all"
              :class="selectedInterval === plan.interval ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
              @click="setSelectedInterval(plan.interval)"
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
                <span class="font-semibold text-green-600 dark:text-green-400">{{ plan.trialDays }}-day free trial</span><br>
                Base Plan ({{ plan.price }}).<br>
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
      <UButton
        label="Upgrade to Pro"
        color="primary"
        :loading="loading"
        @click="handleUpgrade"
      />
    </template>
  </UModal>
</template>
