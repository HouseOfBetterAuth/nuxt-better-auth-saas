<script setup lang="ts">
interface PlanConfig {
  priceNumber: number
  seatPriceNumber: number
  interval: string
}

interface PreviewData {
  amountDue: number
  periodEnd?: number
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

const { formatDateShort } = useDate()

// Helper to calculate the recurring amount
const recurringAmount = computed(() => {
  if (!props.planConfig)
    return 0
  const base = props.planConfig.priceNumber
  // Additional seats = total - 1 (since 1 is included in base)
  const additional = Math.max(0, props.targetSeats - 1)
  return base + (additional * props.planConfig.seatPriceNumber)
})

const additionalSeatsCount = computed(() => {
  return Math.max(0, props.targetSeats - props.currentSeats)
})
</script>

<template>
  <div
    v-if="preview"
    class="space-y-4 text-sm"
  >
    <!-- Description (optional) -->
    <p
      v-if="showDescription"
      class="text-muted-foreground"
    >
      <template v-if="targetSeats > currentSeats">
        You are adding {{ targetSeats - currentSeats }} seat(s).
      </template>
      <template v-else-if="targetSeats < currentSeats">
        You are removing {{ currentSeats - targetSeats }} seat(s).
        <span v-if="preview.periodEnd">
          Your new rate will be <strong>${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}</strong>
          starting on {{ formatDateShort(new Date(preview.periodEnd * 1000)) }}.
        </span>
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
          ${{ (
            (planConfig?.priceNumber || 0)
            + (Math.max(0, currentSeats - 1) * (planConfig?.seatPriceNumber || 0))
          ).toFixed(2) }}/{{ planConfig?.interval === 'year' ? 'yr' : 'mo' }}
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
        <span>${{ (planConfig?.priceNumber || 0).toFixed(2) }}</span>
      </div>
      <div class="flex justify-between">
        <span>Additional Seats ({{ targetSeats > 1 ? targetSeats - 1 : 0 }} x ${{ (planConfig?.seatPriceNumber || 0).toFixed(2) }}):</span>
        <span>${{ (Math.max(0, targetSeats - 1) * (planConfig?.seatPriceNumber || 0)).toFixed(2) }}</span>
      </div>
    </div>

    <!-- Proration / Amount Due Section -->
    <div
      v-if="!isTrialing"
      class="pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-muted-foreground space-y-1"
    >
      <!-- NON-ZERO CHARGE CASE -->
      <div v-if="preview.amountDue !== 0">
        <div class="text-muted-foreground text-sm mb-2">
          {{ preview.amountDue > 0 ? 'Prorated amount due now:' : 'Credit applied to balance:' }}
        </div>

        <!-- Line Items Breakdown -->
        <div class="bg-gray-50 dark:bg-gray-800 rounded-md p-3 space-y-2 mb-2">
          <!-- Adding seats -->
          <template v-if="additionalSeatsCount > 0">
            <div class="flex justify-between text-xs">
              <span class="text-muted-foreground">
                {{ additionalSeatsCount }} seat{{ additionalSeatsCount === 1 ? '' : 's' }} × ${{ (planConfig?.seatPriceNumber || 0).toFixed(2) }}/{{ planConfig?.interval }} (prorated)
              </span>
              <span class="font-medium">${{ (preview.amountDue / 100).toFixed(2) }}</span>
            </div>
          </template>
          <!-- Removing seats (credit) -->
          <template v-else-if="currentSeats > targetSeats">
            <div class="flex justify-between text-xs">
              <span class="text-muted-foreground">
                {{ currentSeats - targetSeats }} seat{{ (currentSeats - targetSeats) === 1 ? '' : 's' }} removed (prorated credit)
              </span>
              <span class="font-medium text-amber-600">-${{ (Math.abs(preview.amountDue) / 100).toFixed(2) }}</span>
            </div>
          </template>

          <!-- Total -->
          <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
            <span class="font-medium text-sm">Total</span>
            <span
              class="font-bold text-sm"
              :class="preview.amountDue > 0 ? 'text-primary' : 'text-amber-600'"
            >
              {{ preview.amountDue > 0 ? '' : '-' }}${{ (Math.abs(preview.amountDue) / 100).toFixed(2) }}
            </span>
          </div>

          <!-- Immediate charge warning -->
          <div
            v-if="preview.amountDue > 0"
            class="flex items-start gap-2 pt-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <UIcon
              name="i-lucide-credit-card"
              class="w-4 h-4 shrink-0 mt-0.5"
            />
            <span>Your card on file will be charged immediately when you confirm.</span>
          </div>
        </div>

        <!-- Next Billing Info -->
        <div
          v-if="preview.amountDue > 0 && nextChargeDate"
          class="text-xs text-muted-foreground/70 space-x-1"
        >
          <span>New rate will be</span>
          <strong>
            ${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}
          </strong>
          <span>on your next billing date,</span>
          <strong>{{ nextChargeDate }}</strong>.
        </div>
      </div>

      <!-- ZERO CHARGE CASE -->
      <div
        v-else
        class="text-center space-y-2 pt-1"
      >
        <p>
          No payment due today. Your current plan already covers this number of seats for the rest of your current billing period.
        </p>
        <p v-if="nextChargeDate">
          On your next billing date,
          <strong>{{ nextChargeDate }}</strong>,
          your subscription will renew at
          <strong>
            ${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }}
          </strong>
          for {{ targetSeats }} seat{{ targetSeats === 1 ? '' : 's' }}.
        </p>
      </div>
    </div>

    <!-- TRIAL CASE -->
    <div
      v-else
      class="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3"
    >
      <!-- Trial Explanation -->
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
            <p>
              Adding team members requires an active Pro subscription.
              Your trial will end and your subscription will begin immediately.
            </p>
          </div>
        </div>
      </div>

      <!-- Amount Due Box -->
      <div class="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium">Amount due now:</span>
          <span class="text-xl font-bold text-primary">${{ (preview.amountDue / 100).toFixed(2) }}</span>
        </div>
        <p class="text-xs text-muted-foreground">
          This starts your Pro subscription with {{ targetSeats }} seat{{ targetSeats === 1 ? '' : 's' }}.
          You'll be billed ${{ recurringAmount.toFixed(2) }}/{{ planConfig?.interval }} going forward.
        </p>
      </div>
    </div>
  </div>
</template>
