<script setup lang="ts" generic="T">
const { columns } = defineProps<{
  columns: AdminTableColumn<T>[]
}>()

const selectedColumns = defineModel<string[]>('selectedColumns', { default: [] })

const columnOptions = computed(() => columns.filter(column => column.accessorKey))

const columnItems = computed(() => columnOptions.value.map(column => ({
  label: column.header,
  type: 'checkbox' as const,
  checked: selectedColumns.value.includes(column.accessorKey!),
  onUpdateChecked(checked: boolean) {
    const newSelectedColumns = [...selectedColumns.value]
    if (checked) {
      newSelectedColumns.push(column.accessorKey!)
    } else {
      const index = newSelectedColumns.indexOf(column.accessorKey!)
      if (index > -1) {
        newSelectedColumns.splice(index, 1)
      }
    }
    selectedColumns.value = newSelectedColumns
  }
})))
</script>

<template>
  <UDropdownMenu
    v-if="columnOptions.length"
    arrow
    :items="columnItems"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-settings-2"
    />
  </UDropdownMenu>
</template>
