import type { RowData } from '@tanstack/vue-table'
import type { ShallowRef } from 'vue'
import type { UTableInstance } from '../types'

export default function useSelectControl<T extends RowData>(tableRef: ShallowRef<UTableInstance | null>, rowId?: string) {
  const selectColumnId = 'admin-table-select'
  const getRowId = (originalRow: T, index: number) => {
    if (rowId) {
      return `${(originalRow as Record<string, any>)[rowId] || index}`
    } else {
      return `${index}`
    }
  }
  const selectedRowCount = computed(() => {
    return tableRef.value?.tableApi?.getFilteredSelectedRowModel().rows.length || 0
  })
  const rowCount = computed(() => {
    return tableRef.value?.tableApi?.getFilteredRowModel().rows.length || 0
  })
  return {
    selectColumnId,
    getRowId,
    selectedRowCount,
    rowCount
  }
}
