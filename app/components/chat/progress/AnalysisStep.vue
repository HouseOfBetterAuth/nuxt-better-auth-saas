<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
  stepType: 'analysis' | 'search'
}

const props = defineProps<Props>()

interface AnalysisResult {
  query?: string
  results?: number
  items?: Array<{ path: string, lines?: string }>
  content?: string
}

// Extract analysis/search information from step.result
const analysisData = computed<AnalysisResult>(() => {
  return (props.step.result || {}) as AnalysisResult
})

const hasResults = computed(() => {
  return analysisData.value.results !== undefined
    || (Array.isArray(analysisData.value.items) && analysisData.value.items.length > 0)
})
</script>

<template>
  <div class="analysis-step space-y-2">
    <!-- Query/Search Term -->
    <div
      v-if="analysisData.query || step.args?.query"
      class="text-sm"
    >
      <span class="text-muted-600 dark:text-muted-400">
        {{ stepType === 'search' ? 'Searched' : 'Analyzed' }}:
      </span>
      <span class="font-mono ml-1">
        {{ analysisData.query || step.args?.query }}
      </span>
    </div>

    <!-- Results Count -->
    <div
      v-if="hasResults"
      class="flex items-center gap-2 text-sm"
    >
      <UIcon
        :name="stepType === 'search' ? 'i-lucide-search' : 'i-lucide-file-text'"
        class="h-4 w-4 text-muted-500"
      />
      <span class="text-muted-600 dark:text-muted-400">
        {{ analysisData.results ?? analysisData.items?.length ?? 0 }}
        {{ stepType === 'search' ? 'results' : 'items' }}
      </span>
    </div>

    <!-- Analysis Items (if available) -->
    <div
      v-if="Array.isArray(analysisData.items) && analysisData.items.length > 0"
      class="space-y-1 mt-2"
    >
      <div
        v-for="(item, index) in analysisData.items.slice(0, 5)"
        :key="index"
        class="text-xs font-mono text-muted-600 dark:text-muted-400 p-1.5 rounded bg-muted/30 dark:bg-muted-800/30 border border-muted-200 dark:border-muted-800 hover:bg-muted/40 dark:hover:bg-muted-800/40 transition-colors"
      >
        {{ item.path }}{{ item.lines ? `#L${item.lines}` : '' }}
      </div>
      <div
        v-if="analysisData.items.length > 5"
        class="text-xs text-muted-500 italic"
      >
        +{{ analysisData.items.length - 5 }} more
      </div>
    </div>

    <!-- Progress Message -->
    <div
      v-if="step.progressMessage"
      class="text-xs text-muted-500 italic"
    >
      {{ step.progressMessage }}
    </div>

    <!-- Error Display -->
    <div
      v-if="step.status === 'error' && step.error"
      class="mt-2 p-2 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400"
    >
      {{ step.error }}
    </div>
  </div>
</template>
