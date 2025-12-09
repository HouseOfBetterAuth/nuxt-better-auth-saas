<script setup lang="ts">
interface PlanConfig {
  price: number
  seatPrice: number
  interval: string
}

interface PaymentMethod {
  type: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

interface LineItem {
  description: string
  amount: number
}

interface PreviewData {
  amountDue: number
  periodEnd?: number
  paymentMethod?: PaymentMethod | null
  isDowngrade?: boolean
  lines?: LineItem[]
}

const props = defineProps<{
  currentSeats: number
  targetSeats: number
  planConfig: PlanConfig | null
  preview: PreviewData | null
  nextChargeDate: string | null
  isTrialing?: boolean
  showDescription?: boolean
}>()

// Helper to calculate the recurring amount
const recurringAmount = computed(() => {
  if (!props.planConfig)
    return 0
  const base = props.planConfig.price
  const additional = Math.max(0, props.targetSeats - 1)
  return base + (additional * props.planConfig.seatPrice)
})

// Calculate current amount
const currentAmount = computed(() => {
  if (!props.planConfig)
    return 0
  const base = props.planConfig.price
  const additional = Math.max(0, props.currentSeats - 1)
  return base + (additional * props.planConfig.seatPrice)
})

const isUpgrade = computed(() => props.targetSeats > props.currentSeats)
const isDowngrade = computed(() => props.targetSeats < props.currentSeats)
const seatDiff = computed(() => Math.abs(props.targetSeats - props.currentSeats))

// Format card brand for display
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
</script>

<template>
  <div
    v-if="preview"
    class="space-y-4 text-sm"
  >
    <!-- Description -->
    <p
      v-if="showDescription"
      class="text-muted-foreground"
    >
      <template v-if="isUpgrade">
        You are adding {{ seatDiff }} seat(s).
      </template>
      <template v-else-if="isDowngrade">
        You are removing {{ seatDiff }} seat(s). Your new rate will be
        <strong>${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}</strong>
        starting on {{ nextChargeDate }}.
      </template>
    </p>

    <!-- Comparison View -->
    <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
      <div>
        <div class="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
          Current
        </div>
        <div class="font-semibold text-lg">
          {{ currentSeats }} Seats
        </div>
        <div class="text-muted-foreground">
          ${{ currentAmount.toFixed(2) }}/{{ planConfig?.interval === 'year' ? 'yr' : 'mo' }}
        </div>
      </div>

      <UIcon
        name="i-lucide-arrow-right"
        class="w-6 h-6 text-gray-400"
      />

      <div>
        <div class="text-xs text-primary uppercase font-bold tracking-wider mb-1">
          New
        </div>
        <div class="font-semibold text-lg text-primary">
          {{ targetSeats }} Seats
        </div>
        <div class="text-primary font-medium">
          ${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval === 'year' ? 'yr' : 'mo' }}
        </div>
      </div>
    </div>

    <!-- Breakdown Details -->
    <div class="text-xs text-muted-foreground space-y-1 px-1">
      <div class="flex justify-between">
        <span>Base Plan (Includes 1 Seat):</span>
        <span>${{ (planConfig?.price || 0).toFixed(2) }}</span>
      </div>
      <div
        v-if="targetSeats > 1"
        class="flex justify-between"
      >
        <span>Additional Seats ({{ targetSeats - 1 }} × ${{ (planConfig?.seatPrice || 0).toFixed(2) }}):</span>
        <span>${{ ((targetSeats - 1) * (planConfig?.seatPrice || 0)).toFixed(2) }}</span>
      </div>
    </div>

    <!-- Proration Section (not for trials) -->
    <div
      v-if="!isTrialing"
      class="pt-2 border-t border-gray-200 dark:border-gray-700"
    >
      <!-- DOWNGRADE - No charge -->
      <div
        v-if="isDowngrade"
        class="space-y-2"
      >
        <div class="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
          <div class="flex items-start gap-2">
            <UIcon
              name="i-lucide-info"
              class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5"
            />
            <p class="text-sm text-blue-700 dark:text-blue-300">
              No charge today. Your seats will be reduced immediately and your new rate will apply on your next billing date.
            </p>
          </div>
        </div>
        <p
          v-if="nextChargeDate"
          class="text-xs text-muted-foreground text-center"
        >
          New rate of <strong>${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}</strong> starts on <strong>{{ nextChargeDate }}</strong>.
        </p>
      </div>

      <!-- UPGRADE - Charge prorated amount -->
      <div
        v-else-if="isUpgrade"
        class="space-y-2"
      >
        <div class="bg-gray-50 dark:bg-gray-800 rounded-md p-3 space-y-2">
          <div class="flex justify-between text-xs">
            <span class="text-muted-foreground">
              {{ seatDiff }} seat{{ seatDiff === 1 ? '' : 's' }} × ${{ (planConfig?.seatPrice || 0).toFixed(2) }}/{{ planConfig?.interval }} (prorated)
            </span>
            <span class="font-medium">${{ (preview.amountDue / 100).toFixed(2) }}</span>
          </div>

          <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
            <span class="font-medium text-sm">Total due</span>
            <span class="font-bold text-sm text-primary">${{ (preview.amountDue / 100).toFixed(2) }}</span>
          </div>

          <!-- Charge warning -->
          <div
            v-if="preview.amountDue > 0"
            class="flex items-start gap-2 pt-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <UIcon
              :name="cardIcon"
              class="w-4 h-4 shrink-0 mt-0.5"
            />
            <span v-if="preview.paymentMethod">
              Your {{ cardBrandDisplay }} ending in {{ preview.paymentMethod.last4 }} will be charged immediately.
            </span>
            <span v-else>Your card on file will be charged immediately.</span>
          </div>
        </div>

        <p
          v-if="nextChargeDate"
          class="text-xs text-muted-foreground text-center"
        >
          New rate of <strong>${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}</strong> on <strong>{{ nextChargeDate }}</strong>.
        </p>
      </div>
    </div>

    <!-- TRIAL CASE -->
    <div
      v-else
      class="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3"
    >
      <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <div class="flex gap-2 items-start">
          <UIcon
            name="i-lucide-info"
            class="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
          />
          <div class="text-xs text-amber-800 dark:text-amber-200 space-y-1">
            <p class="font-medium">
              Your trial will end
            </p>
            <p>Adding team members requires an active subscription. Your trial will end and billing will begin immediately.</p>
          </div>
        </div>
      </div>

      <div class="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium">Amount due now:</span>
          <span class="text-xl font-bold text-primary">${{ (preview.amountDue / 100).toFixed(2) }}</span>
        </div>
        <p class="text-xs text-muted-foreground">
          This starts your subscription with {{ targetSeats }} seat{{ targetSeats === 1 ? '' : 's' }}.
          You'll be billed ${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }} going forward.
        </p>
      </div>
    </div>
  </div>
</template>
