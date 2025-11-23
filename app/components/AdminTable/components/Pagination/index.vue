<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
const { hidePagination, selectedRowCount, rowCount, total } = defineProps({
  hidePagination: { type: Boolean, default: false },
  canSelect: { type: Boolean, default: false },
  selectedRowCount: { type: Number, default: 0 },
  rowCount: { type: Number, default: 0 },
  total: { type: Number, default: 0 }
})
const { t } = useI18n()
const page = defineModel('page', { default: 1 })
const limit = defineModel('limit', { default: 20 })
const totalPage = computed(() => {
  return Math.ceil(total / limit.value)
})
const sizes = [5, 20, 50, 100]
</script>

<template>
  <div class="w-full flex flex-col sm:flex-row items-center justify-between py-2 text-sm text-muted border-t border-accented">
    <div class="px-4">
      <span
        v-if="canSelect"
        class="mr-4"
      >
        {{ t('pagination.selectedRows', { selected: selectedRowCount, total: rowCount }) }}
      </span>
      <span>{{ t('pagination.totalRows', { total }) }}</span>
    </div>
    <div
      v-if="!hidePagination"
      class="flex items-center"
    >
      <span class="ml-4 mr-1 text-sm hidden sm:block">{{ t('pagination.rowsPerPage') }}</span>
      <USelect
        v-model="limit"
        :items="sizes"
      />
      <span class="ml-4 mr-4 text-sm">{{ t('pagination.pageOf', { page, totalPage }) }}</span>
      <UPagination
        v-model:page="page"
        :items-per-page="limit"
        :total="total"
        show-edges
      />
    </div>
  </div>
</template>
