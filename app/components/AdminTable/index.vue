<script setup lang="ts" generic="T">
import type { UTableInstance } from './types'
import { useDebounceFn } from '@vueuse/core'
import { FetchError } from 'ofetch'
import { useRoute, useRouter } from 'vue-router'
import ColumnControl from './components/ColumnControl.vue'
import FilterCheckbox from './components/filters/Checkbox/index.vue'
import FilterDateRange from './components/filters/DateRange.vue'
import FilterTabs from './components/filters/Tabs.vue'
import Pagination from './components/Pagination/index.vue'
import SortControl from './components/SortControl/index.vue'
import useColumnControl from './composables/useColumnControl'
import useSelectControl from './composables/useSelectControl'

const { fetchData, columns, filters = [], hidePagination = false, canSelect = false, rowId } = defineProps<{
  fetchData: FetchDataFn<T>
  columns: AdminTableColumn<T>[]
  filters?: AdminTableFilter[]
  hidePagination?: boolean
  canSelect?: boolean
  rowId?: string
}>()

const route = useRoute()
const router = useRouter()
const toast = useToast()

const page = ref<number>(Number(route.query.page) || 1)
const limit = ref<number>(Number(route.query.limit) || 20)
const loading = ref(false)
const total = ref(0)
const data = ref<any[]>([])
const rowSelection = defineModel<Record<string, boolean>>('rowSelection', { default: {} })

const sortOptions = ref<SortOption[]>([])

const tableRef = useTemplateRef<UTableInstance>('table')
const { selectedColumns } = useColumnControl(columns, tableRef)
const { selectColumnId, getRowId, selectedRowCount, rowCount } = useSelectControl(tableRef, rowId)

const fetchTableData = useDebounceFn(async () => {
  loading.value = true
  try {
    const filter: FilterCondition[] = []
    for (const item of filters) {
      if (item.type === 'input') {
        if (item.value) {
          filter.push({ col: item.field, op: 'like', v: item.value })
        }
      } else if (item.type === 'checkbox') {
        if (item.value.length) {
          filter.push({ col: item.field, op: 'in', v: item.value })
        }
      } else if (item.type === 'tabs') {
        if (item.value) {
          filter.push({ col: item.field, op: 'eq', v: item.value })
        }
      } else if (item.type === 'daterange') {
        const { start, end } = item.value
        if (start && end) {
          filter.push({
            col: item.field,
            op: 'between',
            v: [formatToDate(start).toISOString(), endOfDate(formatToDate(end)).toISOString()]
          })
        }
      }
    }
    const result = await fetchData({
      page: page.value,
      limit: limit.value,
      sort: sortOptions.value,
      filter
    })
    data.value = result.data || []
    total.value = result.total || 0
  } catch (error: unknown) {
    if (error instanceof FetchError) {
      toast.add({
        description: error.data?.message || error.message,
        color: 'error',
        icon: 'i-lucide-alert-circle'
      })
    }
    console.error('Error fetching data:', error)
    loading.value = false
  } finally {
    loading.value = false
  }
})

// Watch sortOptions and sync to URL
watch(
  () => sortOptions.value,
  (newSortOptions) => {
    const query = { ...route.query }
    if (newSortOptions.length) {
      query.sort = JSON.stringify(newSortOptions)
    } else {
      delete query.sort
    }
    router.replace({ query })
    fetchTableData()
  },
  { immediate: true, deep: true }
)

// Watch page and limit and sync to URL
watch(
  [page, limit],
  ([newPage, newLimit]) => {
    const query = { ...route.query, page: newPage, limit: newLimit }
    router.replace({ query })
    fetchTableData()
  }
)

const updatePage = (value: number) => {
  page.value = value
}

const updateLimit = (value: number) => {
  limit.value = value
}

const refreshSuccess = ref(false)

const handleRefresh = async () => {
  refreshSuccess.value = false
  await fetchTableData()
  refreshSuccess.value = true
  setTimeout(() => {
    refreshSuccess.value = false
  }, 1000)
}

onMounted(() => {
  if (route.query.sort) {
    try {
      sortOptions.value = JSON.parse(route.query.sort as string)
    } catch {
      sortOptions.value = []
    }
  }
  fetchTableData()
})

defineExpose({
  fetchTableData
})
</script>

<template>
  <div class="max-h-full flex flex-col">
    <FlexThreeColumn class="max-w-full overflow-x-scroll flex-none">
      <template #left>
        <slot name="top-left-before" />
        <template
          v-for="(filter, index) in filters"
          :key="index"
        >
          <UInput
            v-if="filter.type === 'input'"
            v-model="filter.value"
            :placeholder="`${filter.name}...`"
            @update:model-value="fetchTableData"
          />
          <FilterCheckbox
            v-else-if="filter.type === 'checkbox'"
            v-model:filter="filter.value"
            :filter-name="filter.field"
            :name="filter.name"
            :items="filter.items"
            @update:filter="fetchTableData"
          />
          <FilterTabs
            v-else-if="filter.type === 'tabs'"
            v-model:filter="filter.value"
            :filter-name="filter.field"
            :name="filter.name"
            :items="filter.items"
            @update:filter="fetchTableData"
          />
          <FilterDateRange
            v-else-if="filter.type === 'daterange'"
            v-model:date-range="filter.value"
            :filter-name="filter.field"
            :name="filter.name"
            @update:date-range="fetchTableData"
          />
        </template>
        <slot name="top-left-after" />
      </template>
      <template #right>
        <slot name="top-right" />
        <UButton
          :color="refreshSuccess ? 'success' : 'neutral'"
          variant="outline"
          :icon="loading ? 'i-lucide-loader-2' : (refreshSuccess ? 'i-lucide-check' : 'i-lucide-refresh-cw')"
          :loading="loading"
          @click="handleRefresh"
        />
        <SortControl
          v-model:sort-options="sortOptions"
          :columns="columns"
        />
        <ColumnControl
          v-model:selected-columns="selectedColumns"
          :columns="columns"
        />
      </template>
    </FlexThreeColumn>
    <UTable
      ref="table"
      v-model:row-selection="rowSelection"
      :get-row-id="getRowId"
      :loading="loading"
      :columns="canSelect ? [{ id: selectColumnId }, ...columns] : columns"
      :data="data"
      sticky
      class="flex-1"
    >
      <template #[`${selectColumnId}-header`]="{ table }">
        <UCheckbox
          :model-value="table.getIsSomePageRowsSelected()
            ? 'indeterminate'
            : table.getIsAllPageRowsSelected()"
          @update:model-value="(value: boolean | 'indeterminate') =>
            table.toggleAllPageRowsSelected(!!value)"
        />
      </template>
      <template #[`${selectColumnId}-cell`]="{ row }">
        <UCheckbox
          :model-value="row.getIsSelected()"
          @update:model-value="(value: boolean | 'indeterminate') => row.toggleSelected(!!value)"
        />
      </template>
      <template
        v-for="(_, name) in $slots"
        :key="name"
        #[name]="slotData"
      >
        <slot
          :name="name"
          v-bind="slotData"
        />
      </template>
    </UTable>
    <Pagination
      :page="page"
      :limit="limit"
      :total="total"
      :hide-pagination="hidePagination"
      :can-select="canSelect"
      :selected-row-count="selectedRowCount"
      :row-count="rowCount"
      @update:page="updatePage"
      @update:limit="updateLimit"
    />
  </div>
</template>
