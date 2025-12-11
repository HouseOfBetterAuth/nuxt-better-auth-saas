<script setup lang="ts">
interface PlanInfo {
  tierKey: string
  tierName: string
  interval: 'month' | 'year'
  price: number
  seatPrice: number
}

interface ProrationInfo {
  credit: number
  charge: number
  netAmount: number
  amountDue?: number
  effectiveDate: string
}

interface PaymentMethod {
  type: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

interface PreviewData {
  isTrialing?: boolean
  trialEnd?: string
  currentPlan: PlanInfo | null
  newPlan: PlanInfo
  isUpgrade: boolean
  isDowngrade: boolean
  isScheduledDowngrade?: boolean
  seats: number
  proration?: ProrationInfo
  periodEnd?: string
  paymentMethod?: PaymentMethod | null
  message: string
  isSamePlan?: boolean
}

const props = defineProps<{
  preview: PreviewData | null
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const cardBrandDisplay = computed(() => {
  const brand = props.preview?.paymentMethod?.brand
  if (!brand)
    return ''
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover'
  }
  return brands[brand] || brand.charAt(0).toUpperCase() + brand.slice(1)
})

const cardIcon = computed(() => {
  const brand = props.preview?.paymentMethod?.brand
  if (!brand)
    return 'i-lucide-credit-card'
  const icons: Record<string, string> = {
    visa: 'i-simple-icons-visa',
    mastercard: 'i-simple-icons-mastercard',
    amex: 'i-simple-icons-americanexpress'
  }
  return icons[brand] || 'i-lucide-credit-card'
})

const intervalLabel = (interval: string) => interval === 'year' ? 'yearly' : 'monthly'
const intervalShort = (interval: string) => interval === 'year' ? 'yr' : 'mo'

const additionalSeats = computed(() => Math.max(0, (props.preview?.seats || 1) - 1))

const newTotal = computed(() => {
  if (!props.preview?.newPlan)
    return 0
  const base = props.preview.newPlan.price
  return base + (additionalSeats.value * props.preview.newPlan.seatPrice)
})

const currentTotal = computed(() => {
  if (!props.preview?.currentPlan)
    return 0
  const base = props.preview.currentPlan.price
  return base + (additionalSeats.value * props.preview.currentPlan.seatPrice)
})

function handleConfirm() {
  emit('confirm')
}

function formatDate(dateString?: string | null, format: 'long' | 'short' | 'default' = 'default') {
  if (!dateString)
    return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime()))
    return ''
  const formats: Record<typeof format, Intl.DateTimeFormatOptions> = {
    long: { month: 'long', day: 'numeric', year: 'numeric' },
    short: { month: 'short', day: 'numeric', year: 'numeric' },
    default: { year: 'numeric', month: 'numeric', day: 'numeric' }
  }
  return date.toLocaleDateString('en-US', formats[format])
}
</script>

<template>
  <div class="space-y-6">
    <!-- Same Plan Warning -->
    <div
      v-if="preview?.isSamePlan"
      class="text-center py-8"
    >
      <UIcon
        name="i-lucide-check-circle"
        class="w-12 h-12 text-green-500 mx-auto mb-3"
        aria-label="Current plan"
      />
      <p class="text-lg font-medium">
        You're already on this plan
      </p>
    </div>

    <template v-else-if="preview && preview.newPlan">
      <!-- Plan Comparison -->
      <div class="grid grid-cols-2 gap-4">
        <!-- Current Plan -->
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
          <p class="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Current Plan
          </p>
          <p class="font-semibold text-lg">
            {{ preview.currentPlan?.tierName || 'Free' }}
          </p>
          <p
            v-if="preview.currentPlan"
            class="text-sm text-muted-foreground"
          >
            ${{ currentTotal.toFixed(2) }}/{{ intervalLabel(preview.currentPlan.interval) }}
          </p>
        </div>

        <!-- New Plan -->
        <div class="p-4 rounded-lg bg-primary/10 border-2 border-primary">
          <p class="text-xs text-primary uppercase tracking-wider mb-2">
            New Plan
          </p>
          <p class="font-semibold text-lg">
            {{ preview.newPlan.tierName }}
          </p>
          <p class="text-sm text-muted-foreground">
            ${{ preview.newPlan.price.toFixed(2) }}/{{ intervalLabel(preview.newPlan.interval) }}
          </p>
        </div>
      </div>

      <!-- Upgrade Badge -->
      <div
        v-if="preview.isUpgrade"
        class="flex items-center justify-center gap-2 text-green-600 dark:text-green-400"
      >
        <UIcon
          name="i-lucide-arrow-up-circle"
          class="w-5 h-5"
          aria-label="Upgrade indicator"
        />
        <span class="font-medium">Upgrade</span>
      </div>

      <!-- Downgrade Badge -->
      <div
        v-if="preview.isDowngrade"
        class="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400"
      >
        <UIcon
          name="i-lucide-arrow-down-circle"
          class="w-5 h-5"
          aria-label="Downgrade indicator"
        />
        <span class="font-medium">{{ preview.isScheduledDowngrade ? 'Scheduled Downgrade' : 'Downgrade' }}</span>
      </div>

      <!-- Scheduled Downgrade Info -->
      <div
        v-if="preview.isScheduledDowngrade"
        class="space-y-3"
      >
        <!-- No Payment Badge -->
        <div class="flex items-center justify-center gap-2 py-2 px-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <UIcon
            name="i-lucide-check-circle"
            class="w-5 h-5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
          <span class="font-medium text-green-700 dark:text-green-300">No payment required</span>
        </div>

        <!-- Schedule Info -->
        <div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div class="flex items-start gap-3">
            <UIcon
              name="i-lucide-calendar"
              class="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5"
              aria-hidden="true"
            />
            <div class="flex-1">
              <p class="font-medium text-blue-900 dark:text-blue-100 text-sm">
                Plan changes on {{ formatDate(preview.periodEnd, 'long') || 'your next billing date' }}
              </p>
              <p class="text-sm text-blue-700 dark:text-blue-300 mt-1">
                You'll keep {{ preview.currentPlan?.tierName }} features until then.
                <span v-if="preview.periodEnd">On <strong>{{ formatDate(preview.periodEnd, 'short') }}</strong>, you'll</span>
                <span v-else>You'll</span>
                be charged <strong>${{ newTotal.toFixed(2) }}/{{ intervalLabel(preview.newPlan.interval) }}</strong> for {{ preview.newPlan.tierName }}.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Trial Info -->
      <div
        v-if="preview.isTrialing"
        class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
      >
        <div class="flex items-start gap-3">
          <UIcon
            name="i-lucide-info"
            class="w-5 h-5 text-blue-500 mt-0.5"
            aria-hidden="true"
          />
          <div>
            <p class="font-medium text-blue-900 dark:text-blue-100">
              Trial Active
            </p>
            <p class="text-sm text-blue-700 dark:text-blue-300">
              {{ preview.message }}
            </p>
          </div>
        </div>
      </div>

      <!-- Proration Details (for active subscriptions) -->
      <div
        v-if="!preview.isTrialing && preview.proration"
        class="space-y-3"
      >
        <!-- Upgrade: Show charge -->
        <div
          v-if="preview.isUpgrade"
          class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-2"
        >
          <p class="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Proration for remaining billing period
          </p>
          <div
            v-if="preview.proration.credit > 0"
            class="flex justify-between text-sm"
          >
            <span class="text-muted-foreground">Credit for unused {{ preview.currentPlan?.tierName || 'plan' }} time</span>
            <span class="text-green-600 dark:text-green-400">-${{ preview.proration.credit.toFixed(2) }}</span>
          </div>
          <div
            v-if="preview.proration.charge > 0"
            class="flex justify-between text-sm"
          >
            <span class="text-muted-foreground">Charge for {{ preview.newPlan.tierName }} (prorated)</span>
            <span>${{ preview.proration.charge.toFixed(2) }}</span>
          </div>
          <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
            <span class="font-medium">Due now</span>
            <span class="font-bold text-lg">${{ preview.proration.netAmount.toFixed(2) }}</span>
          </div>
        </div>

        <!-- All plan downgrades are now scheduled at end of billing cycle -->
        <div
          v-if="preview.isUpgrade && preview.proration.amountDue && preview.proration.amountDue > 0"
          class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
        >
          <div class="flex items-start gap-3">
            <UIcon
              name="i-lucide-credit-card"
              class="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5"
              aria-hidden="true"
            />
            <div class="flex-1">
              <p class="text-sm text-amber-700 dark:text-amber-300">
                You'll be charged <span class="font-bold">${{ preview.proration.amountDue.toFixed(2) }}</span> for the remaining time on your new plan.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- New Plan Breakdown -->
      <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-2">
        <p class="text-xs text-muted-foreground uppercase tracking-wider mb-3">
          New Recurring Charges
        </p>

        <!-- Base plan -->
        <div class="flex justify-between text-sm">
          <span class="text-muted-foreground">{{ preview.newPlan.tierName }} Plan (includes 1 seat)</span>
          <span>${{ preview.newPlan.price.toFixed(2) }}/{{ intervalShort(preview.newPlan.interval) }}</span>
        </div>

        <!-- Additional seats -->
        <div
          v-if="additionalSeats > 0"
          class="flex justify-between text-sm"
        >
          <span class="text-muted-foreground">Additional seats ({{ additionalSeats }} × ${{ preview.newPlan.seatPrice.toFixed(2) }})</span>
          <span>${{ (additionalSeats * preview.newPlan.seatPrice).toFixed(2) }}/{{ intervalShort(preview.newPlan.interval) }}</span>
        </div>

        <!-- Total -->
        <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <span class="font-medium">Total per {{ intervalLabel(preview.newPlan.interval) }}</span>
          <span class="font-bold text-lg">${{ newTotal.toFixed(2) }}</span>
        </div>

        <!-- Comparison with current -->
        <div
          v-if="preview.currentPlan"
          class="flex justify-between text-xs pt-1"
        >
          <span class="text-muted-foreground">Currently paying</span>
          <span class="text-muted-foreground">${{ currentTotal.toFixed(2) }}/{{ intervalShort(preview.currentPlan.interval) }}</span>
        </div>
      </div>

      <!-- Payment Method -->
      <div
        v-if="preview.paymentMethod && preview.isUpgrade && !preview.isTrialing"
        class="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <UIcon
          :name="cardIcon"
          class="w-5 h-5"
          aria-hidden="true"
        />
        <span>{{ cardBrandDisplay }} ending in {{ preview.paymentMethod.last4 }} will be charged</span>
      </div>

      <!-- Next Billing Date (for upgrades) -->
      <div
        v-if="preview.periodEnd && !preview.isScheduledDowngrade"
        class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-muted-foreground"
      >
        <div class="flex justify-between">
          <span>Next billing date:</span>
          <strong>{{ formatDate(preview.periodEnd, 'default') }}</strong>
        </div>
      </div>
    </template>

    <!-- Actions -->
    <div class="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        @click="emit('cancel')"
      />
      <UButton
        v-if="!preview?.isSamePlan"
        :label="preview?.isUpgrade ? 'Confirm Upgrade' : 'Confirm Change'"
        :color="preview?.isUpgrade ? 'primary' : 'neutral'"
        :loading="loading"
        @click="handleConfirm"
      />
    </div>
  </div>
</template>
