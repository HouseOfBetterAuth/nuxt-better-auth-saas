<script setup lang="ts">
import { computed } from 'vue'
import { toolDisplayNames } from './constants/toolNames'

interface Props {
  stepNumber: number
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  collapsed: boolean
  hideStepNumber?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hideStepNumber: false
})
const emit = defineEmits<{
  (event: 'toggle'): void
}>()

const displayName = computed(() =>
  toolDisplayNames[props.toolName] || props.toolName
)

const statusIcon = computed(() => {
  switch (props.status) {
    case 'preparing':
      return 'i-lucide-clock'
    case 'running':
      return 'i-lucide-loader-circle'
    case 'success':
      return 'i-lucide-check-circle'
    case 'error':
      return 'i-lucide-x-circle'
    default:
      return 'i-lucide-circle'
  }
})

const statusColor = computed(() => {
  switch (props.status) {
    case 'preparing':
      return 'neutral'
    case 'running':
      return 'primary'
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <button
    type="button"
    class="step-header flex items-center gap-3 px-4 py-3 w-full text-left cursor-pointer hover:bg-muted/50 dark:hover:bg-muted-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
    :aria-expanded="!collapsed"
    aria-label="Toggle step details"
    @click="emit('toggle')"
  >
    <!-- Step Number Badge (hidden for single steps) -->
    <UBadge
      v-if="!hideStepNumber"
      :color="statusColor"
      variant="soft"
      size="sm"
      class="font-mono font-semibold min-w-[2rem] justify-center"
    >
      {{ stepNumber }}
    </UBadge>

    <!-- Status Icon -->
    <UIcon
      :name="statusIcon"
      class="h-4 w-4 flex-shrink-0"
      :class="status === 'running' ? 'animate-spin' : (status === 'preparing' ? 'animate-pulse' : '')"
      :dynamic="true"
    />

    <!-- Tool Name -->
    <span class="font-medium text-sm flex-1">
      {{ displayName }}
    </span>

    <!-- Status Badge -->
    <UBadge
      v-if="status !== 'success'"
      :color="statusColor"
      variant="soft"
      size="xs"
      class="font-medium"
    >
      {{ status === 'preparing' ? 'Preparing...' : status === 'running' ? 'Running...' : 'Failed' }}
    </UBadge>
    <UBadge
      v-else
      color="success"
      variant="soft"
      size="xs"
      class="font-medium"
    >
      Complete
    </UBadge>

    <!-- Collapse/Expand Icon -->
    <UIcon
      :name="collapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
      class="h-4 w-4 text-muted-500 flex-shrink-0"
    />
  </button>
</template>
