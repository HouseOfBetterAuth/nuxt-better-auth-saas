<script setup lang="ts">
import type { PlanInterval, PlanKey } from '~~/shared/utils/plans'
import { getTierForInterval, PAID_TIERS, PLAN_TIERS } from '~~/shared/utils/plans'

const props = defineProps<{
  currentTierKey: PlanKey
  currentInterval: PlanInterval
  isTrialing?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', tierKey: Exclude<PlanKey, 'free'>, interval: PlanInterval): void
}>()

// Each tier has its own interval selection
const tierIntervals = ref<Record<string, PlanInterval>>({
  pro: props.currentTierKey === 'pro' ? props.currentInterval : 'year',
  business: props.currentTierKey === 'business' ? props.currentInterval : 'year'
})

// Get plan config for display
function getPlanConfig(tierKey: Exclude<PlanKey, 'free'>) {
  return getTierForInterval(tierKey, tierIntervals.value[tierKey] || 'year')
}

// Check if this is the current plan
function isCurrentPlan(tierKey: string) {
  return tierKey === props.currentTierKey && tierIntervals.value[tierKey] === props.currentInterval
}

// Check if this tier is the current tier (regardless of interval)
function isCurrentTier(tierKey: string) {
  return tierKey === props.currentTierKey
}

// Check if this is an upgrade or downgrade
function getPlanAction(tierKey: Exclude<PlanKey, 'free'>) {
  const selectedInterval = tierIntervals.value[tierKey] || 'year'

  if (tierKey === props.currentTierKey && selectedInterval === props.currentInterval)
    return 'current'

  const currentTier = PLAN_TIERS[props.currentTierKey as Exclude<PlanKey, 'free'>]
  const targetTier = PLAN_TIERS[tierKey]

  if (!currentTier)
    return 'upgrade' // Free user

  if (targetTier.order > currentTier.order)
    return 'upgrade'
  if (targetTier.order < currentTier.order)
    return 'downgrade'

  // Same tier, different interval
  if (selectedInterval === 'year' && props.currentInterval === 'month')
    return 'upgrade'
  return 'downgrade'
}

function getButtonLabel(tierKey: Exclude<PlanKey, 'free'>) {
  const action = getPlanAction(tierKey)
  if (action === 'current')
    return 'Current Plan'
  if (action === 'upgrade')
    return 'Upgrade'
  return 'Downgrade'
}

function getButtonColor(tierKey: Exclude<PlanKey, 'free'>) {
  const action = getPlanAction(tierKey)
  if (action === 'current')
    return 'neutral'
  if (action === 'upgrade')
    return 'primary'
  return 'gray'
}

function handleSelect(tierKey: Exclude<PlanKey, 'free'>) {
  const selectedInterval = tierIntervals.value[tierKey] || 'year'
  if (!(tierKey === props.currentTierKey && selectedInterval === props.currentInterval)) {
    emit('select', tierKey, selectedInterval)
  }
}

// Calculate yearly savings
function getYearlySavings(tierKey: Exclude<PlanKey, 'free'>) {
  const tier = PLAN_TIERS[tierKey]
  const monthlyTotal = tier.monthly.price * 12
  const yearlyTotal = tier.yearly.price
  return Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Tier Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div
        v-for="tier in PAID_TIERS"
        :key="tier.key"
        class="relative rounded-xl border-2 transition-all"
        :class="[
          isCurrentTier(tier.key)
            ? 'border-primary bg-primary/5'
            : 'border-gray-200 dark:border-gray-700 hover:border-primary/50',
          tier.order === 2 ? 'ring-2 ring-primary ring-offset-2' : ''
        ]"
      >
        <!-- Popular Badge -->
        <div
          v-if="tier.order === 2 && !isCurrentTier(tier.key)"
          class="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full"
        >
          Most Popular
        </div>

        <!-- Current Plan Badge -->
        <div
          v-if="isCurrentTier(tier.key)"
          class="absolute -top-3 right-4 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full"
        >
          Current
        </div>

        <div class="p-6">
          <!-- Header -->
          <div class="mb-4">
            <h3 class="text-xl font-bold">
              {{ tier.name }}
            </h3>
            <p class="text-sm text-muted-foreground mt-1">
              {{ tier.order === 1 ? 'For individuals and small teams' : 'For growing businesses' }}
            </p>
          </div>

          <!-- Interval Toggle (per tier) -->
          <div class="mb-4">
            <div class="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-full">
              <button
                class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                :class="tierIntervals[tier.key] === 'month'
                  ? 'bg-white dark:bg-gray-700 shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'"
                @click="tierIntervals[tier.key] = 'month'"
              >
                Monthly
              </button>
              <button
                class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all relative"
                :class="tierIntervals[tier.key] === 'year'
                  ? 'bg-white dark:bg-gray-700 shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'"
                @click="tierIntervals[tier.key] = 'year'"
              >
                Yearly
                <span class="ml-1 text-green-600 dark:text-green-400 font-bold">
                  -{{ getYearlySavings(tier.key as Exclude<PlanKey, 'free'>) }}%
                </span>
              </button>
            </div>
          </div>

          <!-- Price -->
          <div class="mb-6">
            <div class="flex items-baseline gap-1">
              <span class="text-4xl font-bold">${{ getPlanConfig(tier.key as Exclude<PlanKey, 'free'>).price.toFixed(2) }}</span>
              <span class="text-muted-foreground">/{{ tierIntervals[tier.key] === 'year' ? 'yr' : 'mo' }}</span>
            </div>
            <p class="text-sm text-muted-foreground mt-1">
              + ${{ getPlanConfig(tier.key as Exclude<PlanKey, 'free'>).seatPrice.toFixed(2) }}/{{ tierIntervals[tier.key] === 'year' ? 'yr' : 'mo' }} per seat
            </p>
            <p
              v-if="tierIntervals[tier.key] === 'year'"
              class="text-sm text-green-600 dark:text-green-400 mt-1"
            >
              Save {{ getYearlySavings(tier.key as Exclude<PlanKey, 'free'>) }}% vs monthly
            </p>
          </div>

          <!-- Features -->
          <ul class="space-y-2 mb-6">
            <li
              v-for="feature in tier.features"
              :key="feature"
              class="flex items-center gap-2 text-sm"
            >
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-green-500 shrink-0"
              />
              <span>{{ feature }}</span>
            </li>
          </ul>

          <!-- CTA Button -->
          <UButton
            :label="getButtonLabel(tier.key as Exclude<PlanKey, 'free'>)"
            :color="getButtonColor(tier.key as Exclude<PlanKey, 'free'>)"
            :disabled="isCurrentPlan(tier.key)"
            block
            size="lg"
            class="cursor-pointer"
            @click="handleSelect(tier.key as Exclude<PlanKey, 'free'>)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
