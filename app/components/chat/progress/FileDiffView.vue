<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
}

const props = defineProps<Props>()

// TODO: Extract file edit information from step.result
// This structure may need to be defined based on actual tool responses
const fileEdits = computed(() => {
  // Expected structure (to be confirmed):
  // step.result.fileEdits = [
  //   { filePath: 'path/to/file.ts', additions: 108, deletions: 0, diffUrl?: string }
  // ]
  return props.step.result?.fileEdits || []
})

const hasFileEdits = computed(() => fileEdits.value.length > 0)

function openDiff(url: string) {
  if (!import.meta.client || typeof window === 'undefined') {
    return
  }

  try {
    // Parse and validate URL
    const parsedUrl = new URL(url)

    // Only allow http: and https: schemes
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      console.error('Invalid URL scheme:', parsedUrl.protocol)
      return
    }

    // Ensure hostname is not empty
    if (!parsedUrl.hostname || parsedUrl.hostname.trim() === '') {
      console.error('Invalid URL: empty hostname')
      return
    }

    // Block data: and javascript: schemes (shouldn't reach here due to protocol check, but extra safety)
    if (parsedUrl.href.startsWith('data:') || parsedUrl.href.startsWith('javascript:')) {
      console.error('Invalid URL: blocked scheme')
      return
    }

    // URL is valid, open it
    window.open(parsedUrl.href, '_blank', 'noopener,noreferrer')
  } catch (error) {
    // URL parsing failed - invalid URL
    console.error('Invalid URL:', error)
  }
}
</script>

<template>
  <div class="file-diff-view space-y-2">
    <div
      v-if="hasFileEdits"
      class="space-y-2"
    >
      <div
        v-for="(edit, index) in fileEdits"
        :key="index"
        class="file-edit-item p-2 rounded border border-muted-200 dark:border-muted-800 bg-muted/20 dark:bg-muted-800/30 hover:bg-muted/30 dark:hover:bg-muted-800/40 transition-colors"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-file-code"
              class="h-4 w-4 text-muted-500"
            />
            <span class="text-sm font-mono">
              {{ edit.filePath }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <!-- Diff Stats -->
            <span
              v-if="edit.additions !== undefined || edit.deletions !== undefined"
              class="text-xs font-mono"
            >
              <span class="text-emerald-600 dark:text-emerald-400">
                +{{ edit.additions ?? 0 }}
              </span>
              <span class="text-rose-600 dark:text-rose-400">
                -{{ edit.deletions ?? 0 }}
              </span>
            </span>

            <!-- Open Diff Link -->
            <UButton
              v-if="edit.diffUrl"
              variant="ghost"
              size="xs"
              icon="i-lucide-external-link"
              @click="openDiff(edit.diffUrl)"
            >
              Open diff
            </UButton>
          </div>
        </div>

        <!-- Error Message -->
        <div
          v-if="edit.error"
          class="mt-2 text-xs text-red-600 dark:text-red-400"
        >
          <UIcon
            name="i-lucide-info"
            class="h-3 w-3 inline mr-1"
          />
          {{ edit.error }}
        </div>
      </div>
    </div>

    <!-- Fallback: Show tool name if no file edit data -->
    <div
      v-else
      class="text-sm text-muted-600 dark:text-muted-400"
    >
      {{ step.toolName }} - {{ step.status === 'running' ? 'In progress...' : step.status }}
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
