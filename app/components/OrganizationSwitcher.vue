<script setup lang="ts">
const { organization, session, useActiveOrganization, fetchSession } = useAuth()

// Use useAsyncData for SSR prefetching
const { data: organizations, status } = await useAsyncData('user-organizations', async () => {
  const { data } = await organization.list()
  return data
})

const isPending = computed(() => status.value === 'pending')
const activeOrg = useActiveOrganization()

// Get active organization ID from session
const activeOrgId = computed(() => session.value?.activeOrganizationId)

// Get active org name
const activeOrgName = computed(() => {
  if (!activeOrgId.value || !organizations.value)
    return 'Select team'
  const org = organizations.value.find((o: any) => o.id === activeOrgId.value)
  return org?.name || 'Select team'
})

const activeOrgSlug = computed(() => activeOrg.value?.data?.slug || 't')
const route = useRoute()
const switching = ref(false)

// Handle org change
async function handleOrgChange(orgId: string) {
  if (switching.value)
    return
  if (!organizations.value)
    return

  switching.value = true

  try {
    const org = organizations.value.find((o: any) => o.id === orgId)
    if (!org)
      throw new Error('Organization not found')

    await organization.setActive({ organizationId: orgId })
    // Refetch session to update activeOrganizationId
    await fetchSession()

    // Calculate new path replacing old slug with new slug
    let newPath = route.path
    const currentSlug = activeOrgSlug.value

    // Replace slug segment or /t/ prefix
    if (newPath.includes(`/${currentSlug}`)) {
      newPath = newPath.replace(`/${currentSlug}`, `/${org.slug}`)
    } else if (newPath.startsWith('/t/')) {
      newPath = newPath.replace('/t/', `/${org.slug}/`)
    } else {
      // Fallback if not in a team route
      newPath = `/${org.slug}/dashboard`
    }

    // Force full page reload to get fresh data
    window.location.href = newPath
  } catch (error) {
    console.error('Failed to switch organization:', error)
    switching.value = false
  }
}

// Dropdown items
const dropdownItems = computed(() => {
  if (!organizations.value)
    return []

  const items = organizations.value.map((org: any) => ({
    label: org.name,
    icon: 'i-lucide-building-2',
    slot: 'item',
    orgId: org.id,
    active: org.id === activeOrgId.value,
    click: () => handleOrgChange(org.id)
  }))

  // Add create option at the end
  items.push({
    label: 'Create organization',
    icon: 'i-lucide-plus',
    slot: 'create',
    click: () => {
      // Trigger modal via event bus or global state if possible.
      // For now, we might need to emit an event, but this component is deep in sidebar.
      // We can use a router query or hash to trigger it, or provide/inject.
      // Assuming the Dashboard Layout watches for a trigger or we can access the modal ref.
      // Simpler: Navigate to onboarding? Or emit 'create'
      // Let's try setting a query param that Dashboard Layout watches?
      // Or just reuse the create button logic from layout.
      // Since this is inside Layout -> Sidebar -> Switcher, we can emit.
      // But Switcher is inside a slot or deep structure.
      // Let's dispatch a custom window event for simplicity in this context
      window.dispatchEvent(new CustomEvent('open-create-team-modal'))
    }
  })

  return [items]
})
</script>

<template>
  <div
    v-if="!isPending && organizations"
    class="w-full mb-3 px-2"
  >
    <UDropdownMenu
      :items="dropdownItems"
      :ui="{ content: 'w-60 cursor-pointer', item: { base: 'cursor-pointer', active: 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white' } }"
      arrow
    >
      <button class="flex items-center justify-between w-full px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors group outline-none cursor-pointer">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-5 h-5 rounded bg-green-500 flex items-center justify-center text-white text-xs font-bold shrink-0 select-none">
            {{ activeOrgName.charAt(0).toUpperCase() }}
          </div>
          <span class="font-medium text-sm truncate">{{ activeOrgName }}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 font-medium">Free</span>
        </div>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="w-4 h-4 text-gray-400 group-hover:text-gray-600"
        />
      </button>

      <template #item="{ item }">
        <div
          class="flex items-center justify-between w-full gap-2 truncate cursor-pointer"
          @click="item.click"
        >
          <span class="truncate">{{ item.label }}</span>
          <UIcon
            v-if="item.active"
            name="i-lucide-check"
            class="w-4 h-4 text-primary shrink-0"
          />
        </div>
      </template>

      <template #create="{ item }">
        <div
          class="flex items-center gap-2 text-primary font-medium cursor-pointer"
          @click="item.click"
        >
          <UIcon
            :name="item.icon"
            class="w-4 h-4"
          />
          <span>{{ item.label }}</span>
        </div>
      </template>
    </UDropdownMenu>
  </div>
</template>
