<script setup lang="ts">
import type { Organization } from '~~/shared/utils/types'
import { h, resolveComponent } from 'vue'

const { t } = useI18n()
const UButton = resolveComponent('UButton')
const UAvatar = resolveComponent('UAvatar')
const UIcon = resolveComponent('UIcon')

const filters: AdminTableFilter[] = reactive([
  {
    name: t('global.page.name'),
    field: 'name',
    type: 'input',
    value: undefined
  },
  {
    name: 'Slug',
    field: 'slug',
    type: 'input',
    value: undefined
  }
])

const columns: AdminTableColumn<any>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => {
      return h(
        'div',
        {
          style: {
            paddingLeft: `${row.depth * 0.5}rem`
          },
          class: 'flex items-center gap-2'
        },
        [
          row.depth > 0 ? h(UIcon, { name: 'i-lucide-corner-down-right', class: 'w-4 h-4 text-gray-400' }) : null,
          h('span', { class: 'font-mono text-xs' }, row.original.id)
        ]
      )
    }
  },
  {
    accessorKey: 'name',
    header: t('global.page.name'),
    cell: ({ row }) => {
      if (row.original.user) {
        // It's a member
        return h('div', { class: 'flex items-center gap-2' }, [
          h(UAvatar, { src: row.original.user.image, alt: row.original.user.name, size: '2xs' }),
          h('span', row.original.user.name || row.original.user.email)
        ])
      }
      // It's an organization
      return h('div', { class: 'font-medium' }, row.original.name)
    }
  },
  {
    id: 'actions',
    header: 'Users',
    cell: ({ row }) => {
      if (row.original.user)
        return h('span', '')

      const count = row.original.children?.length || 0
      return h(UButton, {
        color: 'gray',
        variant: 'solid',
        size: 'xs',
        label: `Users ${count}`,
        trailingIcon: row.getIsExpanded() ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down',
        onClick: row.getToggleExpandedHandler()
      })
    }
  },
  {
    accessorKey: 'slug',
    header: 'Slug / Email',
    cell: ({ row }) => {
      if (row.original.user) {
        return row.original.user.email
      }
      return row.original.slug
    }
  },
  {
    accessorKey: 'referralCode',
    header: 'Referral Code',
    cell: ({ row }) => row.original.referralCode || '-'
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => {
      if (row.original.user) {
        return h('span', { class: 'capitalize' }, row.original.role)
      }
      return '-'
    }
  },
  {
    accessorKey: 'createdAt',
    header: t('global.page.createdAt'),
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString()
  }
]

const fetchData: FetchDataFn<any> = async ({ page, limit, sort, filter }) => {
  const result = await $fetch<PageData<Organization>>('/api/admin/list/organization', {
    query: {
      page,
      limit,
      sort: JSON.stringify(sort.map((item) => {
        return [item.field, item.order]
      })),
      filter: JSON.stringify(filter),
      with: JSON.stringify({
        members: {
          with: {
            user: true
          }
        }
      }),
      t: Date.now()
    }
  })

  // Transform data to include children for tree view
  const transformedData = result.data.map(org => ({
    ...org,
    children: org.members || []
  }))

  return {
    data: transformedData,
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
      :get-sub-rows="(row) => row.children"
    />
  </NuxtLayout>
</template>
