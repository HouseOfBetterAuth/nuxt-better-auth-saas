<script setup lang="ts">
interface PlanConfig {
  priceNumber: number
  seatPriceNumber: number
  interval: string
}

interface LineItem {
  description: string
  amount: number
}

interface PreviewData {
  amountDue: number
  periodEnd?: number
  lines?: LineItem[]
}

const props = defineProps<{
  seats: number
  currentPlanConfig: PlanConfig | null
  newPlanConfig: PlanConfig | null
  newInterval: 'month' | 'year'
  preview: PreviewData | null
  isTrialing?: boolean
}>()

const { formatDateShort } = useDate()

// Calculate credit from unused monthly time
const creditAmount = computed(() => {
  if (!props.preview?.lines)
    return 0
  return props.preview.lines
    .filter(l => l.amount < 0)
    .reduce((sum, l) => sum + Math.abs(l.amount), 0)
})

// Calculate the gross yearly charge (before credit)
const grossCharge = computed(() => {
  if (!props.preview?.lines)
    return 0
  return props.preview.lines
    .filter(l => l.amount > 0)
    .reduce((sum, l) => sum + l.amount, 0)
})

// Calculate current total cost
const currentTotal = computed(() => {
  if (!props.currentPlanConfig)
    return 0
  const base = props.currentPlanConfig.priceNumber
  const additional = Math.max(0, props.seats - 1)
  return base + (additional * props.currentPlanConfig.seatPriceNumber)
})

// Calculate new total cost
const newTotal = computed(() => {
  if (!props.newPlanConfig)
    return 0
  const base = props.newPlanConfig.priceNumber
  const additional = Math.max(0, props.seats - 1)
  return base + (additional * props.newPlanConfig.seatPriceNumber)
})

const intervalLabel = computed(() => {
  return props.newInterval === 'year' ? 'yr' : 'mo'
})

const currentIntervalLabel = computed(() => {
  return props.currentPlanConfig?.interval === 'year' ? 'yr' : 'mo'
})
</script>

<template>
  <div
    v-if="preview"
    class="space-y-4 text-sm"
  >
    <!-- Comparison View -->
    <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
      <div>
        <div class="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
          Current
        </div>
        <div class="font-semibold text-lg">
          {{ currentIntervalLabel === 'yr' ? 'Yearly' : 'Monthly' }}
        </div>
        <div class="text-muted-foreground">
          ${{ currentTotal.toFixed(2) }}/{{ currentIntervalLabel }}
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
          {{ intervalLabel === 'yr' ? 'Yearly' : 'Monthly' }}
        </div>
        <div class="text-primary font-medium">
          ${{ newTotal.toFixed(2) }}/{{ intervalLabel }}
        </div>
      </div>
    </div>

    <!-- Proration / Amount Due Section for Yearly Upgrade -->
    <div
      v-if="newInterval === 'year'"
      class="space-y-3"
    >
      <!-- Payment Breakdown Box -->
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
        <div class="text-xs font-medium text-foreground mb-2">
          Payment Breakdown:
        </div>

        <!-- Yearly plan charge -->
        <div class="flex justify-between text-xs">
          <span class="text-muted-foreground">Yearly plan ({{ seats }} seat{{ seats === 1 ? '' : 's' }}):</span>
          <span>${{ (grossCharge / 100).toFixed(2) }}</span>
        </div>

        <!-- Credit for unused monthly -->
        <div
          v-if="creditAmount > 0"
          class="flex justify-between text-xs"
        >
          <span class="text-amber-600 dark:text-amber-400">Credit for unused monthly time:</span>
          <span class="text-amber-600 dark:text-amber-400">-${{ (creditAmount / 100).toFixed(2) }}</span>
        </div>

        <!-- Total Due -->
        <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <span class="font-medium">Due now:</span>
          <span class="text-lg font-bold text-primary">${{ (preview.amountDue / 100).toFixed(2) }}</span>
        </div>

        <!-- Immediate charge warning -->
        <div class="flex items-start gap-2 pt-2 text-xs text-amber-600 dark:text-amber-400">
          <UIcon
            name="i-lucide-credit-card"
            class="w-4 h-4 shrink-0 mt-0.5"
          />
          <span>Your card on file will be charged immediately when you confirm.</span>
        </div>
      </div>

      <!-- Explanation -->
      <p
        v-if="creditAmount > 0"
        class="text-xs text-muted-foreground px-1"
      >
        You're receiving a <strong class="text-amber-600 dark:text-amber-400">${{ (creditAmount / 100).toFixed(2) }}</strong> credit
        for the unused time on your current monthly plan. Your yearly subscription starts today.
      </p>

      <!-- New Plan Details -->
      <div class="text-xs text-muted-foreground space-y-1 px-1">
        <div class="font-medium text-foreground mb-2">
          New Yearly Plan ({{ seats }} seat{{ seats === 1 ? '' : 's' }}):
        </div>
        <div class="flex justify-between">
          <span>Base Plan (1st Seat):</span>
          <span>${{ (newPlanConfig?.priceNumber || 0).toFixed(2) }}/yr</span>
        </div>
        <div
          v-if="seats > 1"
          class="flex justify-between"
        >
          <span>Additional Seats ({{ seats - 1 }} × ${{ (newPlanConfig?.seatPriceNumber || 0).toFixed(2) }}):</span>
          <span>${{ ((seats - 1) * (newPlanConfig?.seatPriceNumber || 0)).toFixed(2) }}/yr</span>
        </div>
        <div class="flex justify-between pt-1 border-t border-gray-200 dark:border-gray-700 font-medium text-foreground">
          <span>Total:</span>
          <span>${{ newTotal.toFixed(2) }}/yr</span>
        </div>
      </div>

      <!-- Billing Schedule -->
      <div
        v-if="preview.periodEnd"
        class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-muted-foreground space-y-2"
      >
        <div class="flex justify-between">
          <span>Next billing date:</span>
          <strong>{{ formatDateShort(new Date(preview.periodEnd * 1000)) }}</strong>
        </div>
      </div>
    </div>

    <!-- Monthly downgrade (scheduled, no charge) -->
    <div
      v-else
      class="pt-3 border-t border-gray-200 dark:border-gray-700 text-center text-muted-foreground"
    >
      <p>No payment due today.</p>
      <p
        v-if="preview.periodEnd"
        class="mt-1"
      >
        Change scheduled for <strong>{{ formatDateShort(new Date(preview.periodEnd * 1000)) }}</strong>.
      </p>
    </div>
  </div>
</template>
