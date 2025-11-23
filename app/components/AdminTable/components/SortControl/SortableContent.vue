<script setup lang="ts" generic="T">
import { useSortable } from '@vueuse/integrations/useSortable'

const { columns, t } = defineProps<{
  columns: AdminTableColumn<T>[]
  t: TranFunction
}>()

const dragEl = useTemplateRef<HTMLElement>('dragEl')
const sortOptions = defineModel<SortOption[]>('sortOptions', { default: [] })

useSortable(dragEl, sortOptions, {
  handle: '.drag-handle'
})

const columnsOptions = computed(() => {
  return columns.filter(column => column.header && column.accessorKey).map(column => ({
    label: column.header as string,
    value: column.accessorKey as string
  }))
})
const existingFields = computed(() => {
  return sortOptions.value.map(sort => sort.field)
})

const availableColumns = computed(() => {
  return columnsOptions.value.filter(option => !existingFields.value.includes(option.value))
})

const findSelectedColumn = (field: string) => {
  if (!field) {
    return []
  }
  return columnsOptions.value.filter(option => option.value === field)
}

const addSort = () => {
  if (availableColumns.value.length === 0) {
    return
  }
  sortOptions.value = [
    ...sortOptions.value,
    { field: availableColumns.value[0]!.value, order: 'asc' }
  ]
}
const removeSort = (index: number) => {
  const updatedSortOptions = [...sortOptions.value]
  updatedSortOptions.splice(index, 1)
  sortOptions.value = updatedSortOptions
}

const resetSorting = () => {
  sortOptions.value = []
}
</script>

<template>
  <div class="p-4 rounded bg-white dark:bg-neutral-800 shadow-md w-80">
    <div class="text-neutral-500 dark:text-neutral-400 text-sm mb-2">
      <span class="font-bold">
        {{ sortOptions.length === 0 ? t('sortControl.noSorting') : t('sortControl.sortBy') }}</span>
      <template v-if="sortOptions.length === 0">
        <br>
        {{ t('sortControl.addSortingHint') }}
      </template>
    </div>
    <div ref="dragEl">
      <div
        v-for="(sort, index) in sortOptions"
        :key="index"
        class="flex items-center mb-2"
      >
        <USelect
          v-model="sort.field"
          :items="[...findSelectedColumn(sort.field), ...availableColumns]"
          class="flex-1 mr-2"
        />
        <USelect
          v-model="sort.order"
          :items="[{ label: t('sortControl.asc'), value: 'asc' }, { label: t('sortControl.desc'), value: 'desc' }]"
          class="w-24 mr-2"
        />
        <UButton
          icon="lucide-trash"
          color="neutral"
          variant="outline"
          class="mr-2"
          @click="removeSort(index)"
        />
        <UButton
          icon="lucide-grip-vertical"
          color="neutral"
          variant="outline"
          class="drag-handle"
        />
      </div>
    </div>
    <div class="flex mt-4 gap-x-2">
      <UButton
        color="neutral"
        variant="solid"
        @click="addSort"
      >
        {{ t('sortControl.addSort') }}
      </UButton>
      <UButton
        v-if="sortOptions.length > 0"
        color="neutral"
        variant="outline"
        @click="resetSorting"
      >
        {{ t('sortControl.resetSorting') }}
      </UButton>
    </div>
  </div>
</template>
