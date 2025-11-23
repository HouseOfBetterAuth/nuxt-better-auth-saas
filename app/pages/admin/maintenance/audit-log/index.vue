<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
interface AuditLog {
  id: number
  userId: string | null
  category: string
  action: string
  targetType: string | null
  targetId: string | null
  ipAddress: string | null
  userAgent: string | null
  status: 'success' | 'failure' | 'pending'
  details: string | null
  createdAt: string // ISO timestamp string
}

const { t } = useI18n()

const filters: AdminTableFilter[] = reactive([
  {
    name: t('auditLog.category'),
    field: 'category',
    type: 'tabs',
    items: [
      { label: t('global.page.all'), id: '' },
      { label: t('auditLog.categories.auth'), id: 'auth' },
      { label: t('auditLog.categories.email'), id: 'email' },
      { label: t('auditLog.categories.payment'), id: 'payment' }
    ],
    value: ''
  },
  {
    name: t('global.page.status'),
    field: 'status',
    type: 'checkbox' as const,
    items: [
      { label: t('auditLog.status.success'), id: 'success', count: 0 },
      { label: t('auditLog.status.failure'), id: 'failure', count: 0 },
      { label: t('auditLog.status.pending'), id: 'pending', count: 0 }
    ],
    value: []
  },
  {
    name: t('global.page.createdAt'),
    field: 'createdAt',
    type: 'daterange',
    value: { start: undefined, end: undefined }
  }
])

const columns: AdminTableColumn<AuditLog>[] = [
  {
    accessorKey: 'id',
    header: 'ID'
  },
  {
    accessorKey: 'category',
    header: t('auditLog.category')
  },
  {
    accessorKey: 'action',
    header: t('auditLog.action')
  },
  {
    accessorKey: 'targetType',
    header: t('auditLog.targetType')
  },
  {
    accessorKey: 'targetId',
    header: t('auditLog.targetId')
  },
  {
    accessorKey: 'status',
    header: t('global.page.status')
  },
  {
    accessorKey: 'ipAddress',
    header: t('auditLog.ipAddress')
  },
  {
    accessorKey: 'userAgent',
    header: t('auditLog.userAgent'),
    cell: cell => showMoreColumn(cell, 20)
  },
  {
    accessorKey: 'details',
    header: t('auditLog.details'),
    cell: cell => showMoreColumn(cell, 20)
  },
  {
    accessorKey: 'createdAt',
    header: t('global.page.createdAt'),
    cell: dateColumn
  }
]

const getStatusColor = (status: string): 'success' | 'warning' | 'error' => {
  switch (status) {
    case 'success':
      return 'success'
    case 'pending':
      return 'warning'
    case 'failure':
      return 'error'
    default:
      return 'warning'
  }
}

const fetchStatusCount = async (filter: FilterCondition[]) => {
  const statusCount = await $fetch<ColumnCount[]>('/api/admin/count/auditLog/status', {
    query: {
      filter: JSON.stringify(filter)
    }
  })
  const statusFilter = filters[1] as FilterTabs
  statusFilter.items.forEach((item) => {
    const status = statusCount.find(status => status.column === item.id)
    item.count = status ? status.count : 0
  })
}

const fetchData: FetchDataFn<AuditLog> = async ({ page, limit, sort, filter }) => {
  fetchStatusCount(filter)
  const result = await $fetch<PageData<AuditLog>>('/api/admin/list/auditLog', {
    query: {
      page,
      limit,
      sort: JSON.stringify(sort.map((item) => {
        return [item.field, item.order]
      })),
      filter: JSON.stringify(filter)
    }
  })
  return {
    data: result.data,
    total: result.total
  }
}
</script>

<template>
  <NuxtLayout name="admin">
    <AdminTable
      :columns="columns"
      :filters="filters"
      :fetch-data="fetchData"
    >
      <template #status-cell="{ row: { original } }">
        <UBadge
          :color="getStatusColor(original.status)"
          :label="t(`auditLog.status.${original.status}`)"
        />
      </template>
    </AdminTable>
  </NuxtLayout>
</template>
