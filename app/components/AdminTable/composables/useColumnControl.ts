import type { ShallowRef } from 'vue'
import type { UTableInstance } from '../types'

export default function useColumnControl<T>(columns: AdminTableColumn<T>[], tableRef: ShallowRef<UTableInstance | null>) {
  const defaultSelectedColumns = columns
    .map(column => (column.accessorKey || column.id)!)
  const selectedColumns = ref(defaultSelectedColumns)

  watchEffect(() => {
    for (const column of columns) {
      const columnKey = (column.accessorKey || column.id)!
      if (selectedColumns.value.includes(columnKey)) {
        tableRef.value?.tableApi?.getColumn(columnKey)?.toggleVisibility(true)
      }
      else {
        tableRef.value?.tableApi?.getColumn(columnKey)?.toggleVisibility(false)
      }
    }
  })
  return {
    selectedColumns
  }
}
