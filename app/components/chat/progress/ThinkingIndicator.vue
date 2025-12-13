<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

interface Props {
  step: Step
  currentActivity?: 'thinking' | 'streaming' | null
}

const props = withDefaults(defineProps<Props>(), {
  currentActivity: null
})

// Reactive elapsed seconds for real-time updates
const elapsedSeconds = ref(0)
let intervalId: ReturnType<typeof setInterval> | null = null

const startTimer = () => {
  // Always clear any existing interval before creating a new one
  stopTimer()

  if (!props.step.timestamp) {
    elapsedSeconds.value = 0
    return
  }

  // Defensively parse and validate the timestamp
  let date: Date
  try {
    date = new Date(props.step.timestamp)
    // Check if the date is valid
    if (!Number.isFinite(date.getTime())) {
      // Invalid timestamp, bail out
      elapsedSeconds.value = 0
      return
    }
  } catch {
    // Parsing failed, bail out
    elapsedSeconds.value = 0
    return
  }

  // Initialize elapsed time immediately
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  elapsedSeconds.value = Math.max(0, diff)

  // Set up interval to update every second
  intervalId = setInterval(() => {
    // Re-validate timestamp on each tick in case it changed
    if (!props.step.timestamp) {
      stopTimer()
      elapsedSeconds.value = 0
      return
    }

    try {
      const currentDate = new Date(props.step.timestamp)
      if (!Number.isFinite(currentDate.getTime())) {
        stopTimer()
        elapsedSeconds.value = 0
        return
      }
      const diff = Math.floor((Date.now() - currentDate.getTime()) / 1000)
      elapsedSeconds.value = Math.max(0, diff)
    } catch {
      stopTimer()
      elapsedSeconds.value = 0
    }
  }, 1000)
}

const stopTimer = () => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

// Calculate thinking time from timestamps - only returns formatted duration, never placeholder text
const thinkingTime = computed(() => {
  // If we're currently thinking, return empty string (template will handle "Thinking..." display)
  if (props.currentActivity === 'thinking' && (props.step.status === 'preparing' || props.step.status === 'running')) {
    return ''
  }

  if (!props.step.timestamp || elapsedSeconds.value < 0) {
    return ''
  }

  try {
    const diffSeconds = elapsedSeconds.value

    if (diffSeconds < 60) {
      return `${diffSeconds}s`
    }

    const minutes = Math.floor(diffSeconds / 60)
    const seconds = diffSeconds % 60
    return `${minutes}m ${seconds}s`
  } catch {
    return ''
  }
})

// Separate computed for processing state
const isProcessing = computed(() => {
  return (props.step.status === 'preparing' || props.step.status === 'running') && !props.step.timestamp
})

// Watch for status changes to start/stop timer
watch(
  () => [props.step.status, props.step.timestamp, props.currentActivity],
  () => {
    if (props.step.status === 'preparing' || props.step.status === 'running') {
      if (props.step.timestamp) {
        startTimer()
      } else {
        // Timestamp is falsy, clear interval
        stopTimer()
        elapsedSeconds.value = 0
      }
    } else {
      stopTimer()
      // Calculate final elapsed time
      if (props.step.timestamp) {
        try {
          const date = new Date(props.step.timestamp)
          if (Number.isFinite(date.getTime())) {
            const diff = Math.floor((Date.now() - date.getTime()) / 1000)
            elapsedSeconds.value = Math.max(0, diff)
          } else {
            elapsedSeconds.value = 0
          }
        } catch {
          elapsedSeconds.value = 0
        }
      } else {
        elapsedSeconds.value = 0
      }
    }
  },
  { immediate: true }
)

onMounted(() => {
  if (props.step.status === 'preparing' || props.step.status === 'running') {
    if (props.step.timestamp) {
      startTimer()
    }
  }
})

onUnmounted(() => {
  stopTimer()
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
        <template v-if="currentActivity === 'thinking' && (step.status === 'preparing' || step.status === 'running')">
          Thinking...
        </template>
        <template v-else-if="thinkingTime">
          Thought for {{ thinkingTime }}
        </template>
        <template v-else-if="isProcessing">
          Processing...
        </template>
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
