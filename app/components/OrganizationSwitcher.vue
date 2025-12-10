<script setup lang="ts">
const { session, useActiveOrganization, user } = useAuth()

// Use shared composable with proper caching
const { data: organizations, status } = useUserOrganizations({ lazy: true })

const dropdownMenuUi = {
  content: 'w-60 cursor-pointer',
  item: 'cursor-pointer data-[active=true]:bg-gray-100 dark:data-[active=true]:bg-gray-800 data-[active=true]:text-gray-900 dark:data-[active=true]:text-white'
}

const isPending = computed(() => status.value === 'pending')
const activeOrg = useActiveOrganization()
const route = useRoute()

// Get active organization ID - prioritize route slug over session for immediate UI updates
const activeOrgId = computed(() => {
  // Use route slug first for immediate reactivity
  const routeSlug = route.params.slug as string
  if (routeSlug && routeSlug !== 't' && organizations.value) {
    const org = organizations.value.find((o: any) => o.slug === routeSlug)
    if (org?.id)
      return org.id
  }
  // Fallback to session
  if (session.value?.activeOrganizationId) {
    return session.value.activeOrganizationId
  }
  return null
})

// Get active org name
const activeOrgName = computed(() => {
  if (!organizations.value)
    return 'Select team'

  // Find by ID or slug
  const routeSlug = route.params.slug as string
  const org = activeOrgId.value
    ? organizations.value.find((o: any) => o.id === activeOrgId.value)
    : organizations.value.find((o: any) => o.slug === routeSlug)

  return org?.name || 'Select team'
})

// Compute active subscription from activeOrg state (populated by layout)
const activeStripeSubscription = computed(() => {
  const data = activeOrg.value?.data

  // Check if the data matches the currently selected org
  // If not, it means we are switching and still have stale data
  if (!data || data.id !== activeOrgId.value) {
    return null
  }

  const subs = (data as any)?.subscriptions || []

  if (!subs || !Array.isArray(subs))
    return null

  return subs.find(
    (sub: any) => sub.status === 'active' || sub.status === 'trialing'
  )
})

// Check if current user is owner or admin
const _canManageTeam = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return false
  const member = activeOrg.value.data.members.find(m => m.userId === user.value!.id)
  return member?.role === 'owner' || member?.role === 'admin'
})

const activeOrgSlug = computed(() => activeOrg.value?.data?.slug || 't')
const switching = ref(false)
const { start, finish } = useLoadingIndicator()

// Handle org change
async function handleOrgChange(orgId: string) {
  if (switching.value)
    return
  if (!organizations.value)
    return

  switching.value = true
  start()

  try {
    const org = organizations.value.find((o: any) => o.id === orgId)
    if (!org)
      throw new Error('Organization not found')

    // Calculate new path BEFORE switching (using current slug)
    let newPath = route.path
    const currentSlug = activeOrgSlug.value

    // Replace slug segment or /t/ prefix
    if (newPath.includes(`/${currentSlug}`)) {
      newPath = newPath.replace(`/${currentSlug}`, `/${org.slug}`)
    } else if (newPath.startsWith('/t/')) {
      newPath = newPath.replace('/t/', `/${org.slug}/`)
    } else {
      // Fallback if not in a team route
      newPath = `/${org.slug}/members`
    }

    // Set active organization and wait for it to complete
    const { error } = await organization.setActive({ organizationId: orgId })

    if (error) {
      throw new Error(error.message || 'Failed to set active organization')
    }

    // Force a full page reload to ensure SSR picks up the new active org context
    window.location.href = newPath
  } catch (error) {
    console.error('Failed to switch organization:', error)
    switching.value = false
    finish()
  }
}

// Dropdown items - use click handler for hard reload
const dropdownItems = computed(() => {
  if (!organizations.value)
    return []

  const currentActiveOrgId = activeOrgId.value // Access to ensure reactivity

  const items = organizations.value.map((org: any) => ({
    label: org.name,
    icon: 'i-lucide-building-2',
    slot: 'item',
    orgId: org.id,
    active: org.id === currentActiveOrgId,
    // Use click handler instead of 'to' prop to force manual handling
    click: () => handleOrgChange(org.id),
    disabled: org.id === currentActiveOrgId
  }))

  // Add create option at the end
  items.push({
    label: 'Create organization',
    icon: 'i-lucide-plus',
    slot: 'create',
    orgId: '',
    active: false,
    disabled: false,
    click: async () => {
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
      :ui="dropdownMenuUi"
      arrow
    >
      <button class="flex items-center justify-between w-full px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors group outline-none cursor-pointer">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-5 h-5 rounded bg-amber-500 flex items-center justify-center text-white text-xs font-bold shrink-0 select-none">
            {{ activeOrgName.charAt(0).toUpperCase() }}
          </div>
          <span class="font-medium text-sm truncate">{{ activeOrgName }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded-full border font-medium"
            :class="activeStripeSubscription ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'"
          >
            {{ activeStripeSubscription ? 'Pro' : 'Free' }}
          </span>
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
