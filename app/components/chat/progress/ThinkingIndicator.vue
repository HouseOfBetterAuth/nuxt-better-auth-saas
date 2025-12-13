<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
  currentActivity?: 'thinking' | 'streaming' | null
}

const props = withDefaults(defineProps<Props>(), {
  currentActivity: null
})

// Calculate thinking time from timestamps
const thinkingTime = computed(() => {
  // If we're currently thinking, show "Thinking..."
  if (props.currentActivity === 'thinking' && (props.step.status === 'preparing' || props.step.status === 'running')) {
    return 'Thinking...'
  }

  if (!props.step.timestamp) {
    return 'Processing...'
  }

  try {
    const timestamp = new Date(props.step.timestamp)
    const now = new Date()
    const diffSeconds = Math.floor((now.getTime() - timestamp.getTime()) / 1000)

    if (diffSeconds < 0) {
      return 'Processing...'
    }

    if (diffSeconds < 60) {
      return `${diffSeconds}s`
    }

    const minutes = Math.floor(diffSeconds / 60)
    const seconds = diffSeconds % 60
    return `${minutes}m ${seconds}s`
  } catch {
    return 'Processing...'
  }
})

// Get thinking content from step.result or step.args
const thinkingContent = computed(() => {
  return props.step.result?.thinking || props.step.args?.thinking || null
})
</script>

<template>
  <div class="thinking-indicator space-y-2">
    <div class="flex items-center gap-2 text-sm">
      <UIcon
        name="i-lucide-brain"
        class="h-4 w-4 text-primary-500 dark:text-primary-400"
        :class="step.status === 'preparing' || step.status === 'running' ? 'animate-pulse' : ''"
      />
      <span class="font-medium text-muted-700 dark:text-muted-300">
        Thought for {{ thinkingTime }}
      </span>
    </div>

    <!-- Expandable thinking content -->
    <div
      v-if="thinkingContent"
      class="mt-2 p-3 rounded-lg bg-muted/50 dark:bg-muted-700/50 border border-muted-200 dark:border-muted-800 text-sm whitespace-pre-wrap text-muted-700 dark:text-muted-300"
    >
      {{ thinkingContent }}
    </div>

    <!-- Placeholder if no content yet -->
    <div
      v-else-if="step.status === 'running' || step.status === 'preparing'"
      class="mt-2 text-xs text-muted-500 dark:text-muted-400 italic flex items-center gap-1"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="h-3 w-3 animate-spin"
      />
      Processing...
    </div>
  </div>
</template>
