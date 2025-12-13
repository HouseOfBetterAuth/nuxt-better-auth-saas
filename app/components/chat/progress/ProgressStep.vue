<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import StepContent from './StepContent.vue'
import StepHeader from './StepHeader.vue'

export interface Step {
  stepNumber: number
  toolCallId: string
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  args?: Record<string, any>
  result?: any
  error?: string
  progressMessage?: string
  timestamp?: string
}

interface Props {
  step: Step
  collapsed?: boolean
  currentActivity?: 'thinking' | 'streaming' | null
  hideStepNumber?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  currentActivity: null,
  hideStepNumber: false
})
const emit = defineEmits<{
  (event: 'toggle', toolCallId: string): void
}>()

const isCollapsed = ref(props.collapsed ?? false)

// Determine step type from toolName and result
const stepType = computed(() => {
  // Check for thinking step first (preparing status with thinking content or currentActivity)
  if (
    (props.step.status === 'preparing' && props.currentActivity === 'thinking') ||
    props.step.result?.thinking ||
    props.step.args?.thinking
  ) {
    return 'thinking'
  }

  // File edit steps
  if (props.step.result?.fileEdits || props.step.toolName.includes('edit')) {
    return 'file_edit'
  }

  // Search steps
  if (props.step.toolName.includes('search')) {
    return 'search'
  }

  // Analysis/read steps
  if (props.step.toolName.includes('read') || props.step.toolName.includes('analyze')) {
    return 'analysis'
  }

  // Default to tool execution
  return 'tool_execution'
})

const handleToggle = () => {
  isCollapsed.value = !isCollapsed.value
  emit('toggle', props.step.toolCallId)
}

// Watch for prop changes
watch(() => props.collapsed, (newVal) => {
  if (newVal !== undefined) {
    isCollapsed.value = newVal
  }
})
</script>

<template>
  <div class="progress-step rounded-lg border border-muted-200 dark:border-muted-800 bg-muted/30 dark:bg-muted-800/50 overflow-hidden my-2">
    <StepHeader
      :step-number="step.stepNumber"
      :tool-name="step.toolName"
      :status="step.status"
      :collapsed="isCollapsed"
      :hide-step-number="hideStepNumber"
      @toggle="handleToggle"
    />

    <div
      v-if="!isCollapsed"
      class="step-content-wrapper transition-all duration-200 ease-in-out"
    >
      <StepContent
        :step="step"
        :step-type="stepType"
        :current-activity="currentActivity"
      />
    </div>
  </div>
</template>
