<script setup lang="ts">
interface Props {
  allCollapsed: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  (event: 'collapseAll'): void
  (event: 'expandAll'): void
}>()
</script>

<template>
  <div class="progress-controls flex items-center justify-between py-2.5 px-1 mb-2 border-b border-muted-200 dark:border-muted-800">
    <h3 class="text-sm font-semibold text-muted-700 dark:text-muted-300">
      Progress Updates
    </h3>

    <UButton
      variant="ghost"
      size="xs"
      :icon="allCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
      @click="allCollapsed ? emit('expandAll') : emit('collapseAll')"
    >
      {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
    </UButton>
  </div>
</template>
