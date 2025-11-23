import type { AdminTable } from '#components'
import type { ComponentExposed } from 'vue-component-type-helpers'

export function useAdminTable(refName: string = 'table') {
  const adminTableRef = useTemplateRef<ComponentExposed<typeof AdminTable>>(refName)
  const refresh = () => {
    adminTableRef.value?.fetchTableData()
  }
  return {
    refresh
  }
}
