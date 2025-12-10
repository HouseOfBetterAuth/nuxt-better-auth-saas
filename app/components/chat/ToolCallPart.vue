<script setup lang="ts">
import type { MessagePart } from '#shared/utils/types'

const props = defineProps<{
  part: Extract<MessagePart, { type: 'tool_call' }>
}>()

const toolDisplayNames: Record<string, string> = {
  source_ingest: 'Ingest Source',
  content_write: 'Write Content',
  edit_section: 'Edit Section',
  edit_metadata: 'Update Metadata',
  read_content: 'Read Content',
  read_section: 'Read Section',
  read_source: 'Read Source',
  read_content_list: 'List Content',
  read_source_list: 'List Sources',
  read_workspace_summary: 'Workspace Summary'
}

const displayName = computed(() => toolDisplayNames[props.part.toolName] || props.part.toolName)

const statusIcon = computed(() => {
  switch (props.part.status) {
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
</script>

<template>
  <div class="tool-call-part">
    <div class="flex items-center gap-2 text-sm">
      <UIcon
        :name="statusIcon"
        class="h-4 w-4"
        :class="part.status === 'running' ? 'animate-spin' : ''"
        :dynamic="true"
      />
      <span class="font-medium">{{ displayName }}</span>
      <UBadge
        v-if="part.status === 'error' && part.error"
        color="error"
        variant="soft"
        size="xs"
      >
        Failed
      </UBadge>
    </div>
    <div
      v-if="part.status === 'error' && part.error"
      class="mt-2 text-xs text-red-600 dark:text-red-400"
    >
      {{ part.error }}
    </div>
  </div>
</template>

<style scoped>
.tool-call-part {
  @apply rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 my-2;
}
</style>
