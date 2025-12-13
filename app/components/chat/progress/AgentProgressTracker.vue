<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { computed, ref } from 'vue'
import ProgressControls from './ProgressControls.vue'
import ProgressStep from './ProgressStep.vue'

interface LiveActivity {
  toolCallId: string
  toolName: string
  status: 'preparing' | 'running'
  args?: Record<string, any>
  progressMessage?: string
  startedAt?: string
}

interface Props {
  message: ChatMessage
  showControls?: boolean
  defaultCollapsed?: boolean
  currentActivity?: 'thinking' | 'streaming' | null
  liveActivities?: LiveActivity[]
}

const props = withDefaults(defineProps<Props>(), {
  showControls: true,
  defaultCollapsed: false,
  currentActivity: null,
  liveActivities: () => []
})

// Extract all tool calls and organize them as numbered steps
const progressSteps = computed(() => {
  const completedSteps = props.message.parts
    .filter(part => part.type === 'tool_call')
    .map((part, index) => ({
      stepNumber: index + 1,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      status: part.status,
      args: part.args,
      result: part.result,
      error: part.error,
      progressMessage: part.progressMessage,
      timestamp: part.timestamp
    }))

  const completedIds = new Set(completedSteps.map(step => step.toolCallId))

  const liveSteps = props.liveActivities
    .filter(activity => !completedIds.has(activity.toolCallId))
    .map(activity => ({
      stepNumber: 0,
      toolCallId: activity.toolCallId,
      toolName: activity.toolName,
      status: activity.status,
      args: activity.args,
      result: null,
      error: undefined,
      progressMessage: activity.progressMessage,
      timestamp: activity.startedAt
    }))

  const getTimestamp = (value?: string | null) => {
    if (!value) {
      return Number.MAX_SAFE_INTEGER
    }
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
  }

  return [...liveSteps, ...completedSteps]
    .sort((a, b) => {
      const aTime = getTimestamp(a.timestamp)
      const bTime = getTimestamp(b.timestamp)
      return aTime - bTime
    })
    .map((step, index) => ({
      ...step,
      stepNumber: index + 1
    }))
})

// Only show tracker if there are tool calls
const hasSteps = computed(() => progressSteps.value.length > 0)

// Global collapse state
const allCollapsed = ref(props.defaultCollapsed)
const individualCollapsed = ref<string[]>([])

const handleCollapseAll = () => {
  allCollapsed.value = true
  individualCollapsed.value = progressSteps.value.map(s => s.toolCallId)
}

const handleExpandAll = () => {
  allCollapsed.value = false
  individualCollapsed.value = []
}

const isStepCollapsed = (toolCallId: string) => {
  return allCollapsed.value || individualCollapsed.value.includes(toolCallId)
}

const toggleStep = (toolCallId: string) => {
  if (allCollapsed.value) {
    // Transition to individual mode: populate with all steps except the one being toggled
    allCollapsed.value = false
    individualCollapsed.value = progressSteps.value
      .map(s => s.toolCallId)
      .filter(id => id !== toolCallId)
    return
  }

  if (individualCollapsed.value.includes(toolCallId)) {
    individualCollapsed.value = individualCollapsed.value.filter(id => id !== toolCallId)
  } else {
    individualCollapsed.value = [...individualCollapsed.value, toolCallId]
  }
}
</script>

<template>
  <div
    v-if="hasSteps"
    class="agent-progress-tracker space-y-2 my-2"
  >
    <ProgressControls
      v-if="showControls"
      :all-collapsed="allCollapsed"
      @collapse-all="handleCollapseAll"
      @expand-all="handleExpandAll"
    />

    <div class="space-y-2">
      <ProgressStep
        v-for="step in progressSteps"
        :key="step.toolCallId"
        :step="step"
        :collapsed="isStepCollapsed(step.toolCallId)"
        :current-activity="currentActivity"
        @toggle="toggleStep(step.toolCallId)"
      />
    </div>
  </div>
</template>
