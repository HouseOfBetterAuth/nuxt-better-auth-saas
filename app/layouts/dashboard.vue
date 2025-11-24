<i18n src="./menu/i18n.json"></i18n>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import SearchPalette from './components/SearchPalette.vue'
import { getUserMenus } from './menu'

const { user, signOut, organization, useActiveOrganization, session } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const isCollapsed = ref(false)
const runtimeConfig = useRuntimeConfig()

const isCreateTeamModalOpen = ref(false)
const newTeamName = ref('')
const newTeamSlug = ref('')
const isSlugManuallyEdited = ref(false)
const creatingTeam = ref(false)
const slugError = ref('')
const isCheckingSlug = ref(false)
const ownedTeamsCount = ref(0)
const selectedPlan = ref('launch') // 'launch' or 'scale'

const fetchOwnedCount = async () => {
  try {
    const { count } = await $fetch('/api/organization/get-owned-count', { headers: useRequestHeaders(['cookie']) })
    ownedTeamsCount.value = count
  } catch (e) {
    console.error('Failed to fetch owned teams count', e)
  }
}

const handleOpenCreateModal = () => {
  isCreateTeamModalOpen.value = true
}

onUnmounted(() => {
  window.removeEventListener('open-create-team-modal', handleOpenCreateModal)
})

watch(isCreateTeamModalOpen, async (isOpen) => {
  if (isOpen) {
    // Reset state
    newTeamName.value = ''
    newTeamSlug.value = ''
    slugError.value = ''
    isSlugManuallyEdited.value = false

    // Re-fetch to ensure fresh data
    await fetchOwnedCount()
  }
})

const showBilling = computed(() => ownedTeamsCount.value > 0)

const checkSlug = useDebounceFn(async (slug: string) => {
  if (!slug || slug.length < 3) {
    return
  }
  isCheckingSlug.value = true
  try {
    const { available } = await $fetch('/api/organization/check-slug', {
      query: { slug },
      headers: useRequestHeaders(['cookie'])
    })
    if (!available) {
      slugError.value = 'Slug is already taken'
    } else {
      slugError.value = ''
    }
  } catch (e) {
    console.error(e)
  } finally {
    isCheckingSlug.value = false
  }
}, 500)

watch(newTeamName, (newName) => {
  if (!isSlugManuallyEdited.value) {
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    newTeamSlug.value = slug
    checkSlug(slug)
  }
})

watch(newTeamSlug, (newSlug) => {
  slugError.value = ''
  if (isSlugManuallyEdited.value) {
    checkSlug(newSlug)
  }
})

// Check for active organization and redirect if needed
onMounted(async () => {
  window.addEventListener('open-create-team-modal', handleOpenCreateModal)

  // Prefetch owned count for smoother UI
  fetchOwnedCount()

  if (!organization)
    return

  const { data: orgs } = await organization.list()
  const routeSlug = route.params.slug as string

  if (!orgs || orgs.length === 0) {
    navigateTo('/onboarding')
    return
  }

  // If URL has a specific slug (not 't' or empty), try to activate that org
  if (routeSlug && routeSlug !== 't') {
    const targetOrg = orgs.find(o => o.slug === routeSlug)
    if (targetOrg && targetOrg.id !== (session.value as any)?.activeOrganizationId) {
      await organization.setActive({ organizationId: targetOrg.id })
      await useAuth().fetchSession()
      // No reload needed, we are on the right URL, just state updated
    } else if (!targetOrg) {
      // Invalid slug, redirect to first available org
      navigateTo(`/${orgs[0].slug}/dashboard`)
    }
  }
  // If generic URL or no active org, ensure one is active and redirect to its slug
  else {
    const activeId = (session.value as any)?.activeOrganizationId
    const activeOrg = activeId ? orgs.find(o => o.id === activeId) : orgs[0]

    if (activeOrg) {
      if (activeOrg.id !== activeId) {
        await organization.setActive({ organizationId: activeOrg.id })
        await useAuth().fetchSession()
      }
      // Redirect to canonical URL
      if (routeSlug !== activeOrg.slug) {
        const newPath = route.path.replace(/^\/t\//, `/${activeOrg.slug}/`)
        navigateTo(newPath)
      }
    }
  }
})

// Check if current user is owner or admin
const canManageTeam = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return false
  const userId = user.value.id
  const member = activeOrg.value.data.members.find(m => m.userId === userId)
  return member?.role === 'owner' || member?.role === 'admin'
})

const activeOrgSlug = computed(() => activeOrg.value?.data?.slug || 't')

defineShortcuts({
  'g-1': () => router.push(localePath(`/${activeOrgSlug.value}/dashboard`))
})
const pathNameItemMap: StringDict<NavigationMenuItem> = {}
const pathNameParentMap: StringDict<NavigationMenuItem | undefined> = {}

const menus = computed(() => getUserMenus(t, localePath, runtimeConfig.public.appRepo, activeOrgSlug.value, canManageTeam.value))

const menuIterator = (menus: NavigationMenuItem[], parent?: NavigationMenuItem) => {
  for (const menu of menus) {
    const to = `${menu.to}`
    pathNameItemMap[to] = menu!
    pathNameParentMap[to] = parent
    if (menu.to == route.path) {
      if (pathNameParentMap[to]) {
        pathNameParentMap[to].defaultOpen = true
      }
    }
    if (menu.children) {
      menuIterator(menu.children, menu)
    }
  }
}

watchEffect(() => {
  const currentMenus = menus.value
  // Re-run menu iterator when menus change
  for (const group of currentMenus) {
    menuIterator(group)
  }
})

const clickSignOut = () => {
  signOut({ redirectTo: localePath('/signin') })
}

async function createTeam() {
  if (!newTeamName.value.trim() || !newTeamSlug.value.trim() || slugError.value)
    return
  creatingTeam.value = true

  try {
    const { data, error } = await organization.create({
      name: newTeamName.value,
      slug: newTeamSlug.value
    })

    if (error)
      throw error

    if (data) {
      await organization.setActive({ organizationId: data.id })
      toast.add({ title: 'Team created successfully', color: 'success' })
      newTeamName.value = ''
      newTeamSlug.value = ''
      isSlugManuallyEdited.value = false
      isCreateTeamModalOpen.value = false
      // Navigate to new team dashboard
      window.location.href = `/${data.slug}/dashboard`
    }
  } catch (e: any) {
    toast.add({
      title: 'Error creating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    creatingTeam.value = false
  }
}
</script>

<template>
  <div>
    <aside
      class="fixed top-0 left-0 transition-all duration-300 hidden sm:block"
      :class="[isCollapsed ? 'w-15' : 'w-64']"
    >
      <div class="h-screen flex flex-col px-3 py-4 bg-neutral-100 dark:bg-neutral-800">
        <a
          v-if="!isCollapsed"
          class="flex items-center ps-2.5"
        >
          <Logo class="h-6 w-6" />
          <span
            class="self-center ml-2 text-xl font-semibold whitespace-nowrap dark:text-white"
          >
            {{ t('global.appName') }}
          </span>
        </a>
        <Logo
          v-if="isCollapsed"
          class="h-6 w-6 ml-1"
        />
        <div
          class="flex flex-col gap-2 mb-2 mt-3"
          :class="{ 'pl-2 pr-2': !isCollapsed }"
        >
          <OrganizationSwitcher v-if="!isCollapsed" />
          <SearchPalette
            :collapsed="isCollapsed"
            :t="t"
          />
        </div>
        <UNavigationMenu
          :items="menus"
          :collapsed="isCollapsed"
          orientation="vertical"
          class="data-[orientation=vertical]:w-full flex-1 overflow-y-auto"
        />
        <div class="flex flex-col pl-2 pr-2">
          <USeparator class="mb-2" />
          <!-- Team Settings (Owner only) or Create Team -->
          <template v-if="!isCollapsed" />
          <UTooltip
            :ui="{ content: 'w-54 flex flex-col h-auto p-0 gap-0' }"
            :delay-duration="100"
            :disable-closing-trigger="true"
          >
            <template #content>
              <UButton
                icon="i-lucide-log-out"
                size="sm"
                color="neutral"
                variant="link"
                class="w-full p-[10px]"
                @click="clickSignOut"
              >
                {{ t('global.auth.signOut') }}
              </UButton>
            </template>
            <div
              class="w-full flex items-center justify-between mt-2 pt-2 pb-2"
              :class="{ 'pl-2 pr-2': !isCollapsed }"
            >
              <div class="flex items-center">
                <UAvatar
                  :src="user?.image || undefined"
                  size="xs"
                  class="border border-neutral-300 dark:border-neutral-700"
                />
                <span
                  v-if="!isCollapsed"
                  class="text-xs ml-2"
                >
                  {{ user?.name }}
                </span>
              </div>
              <UIcon
                v-if="!isCollapsed"
                name="i-lucide-ellipsis-vertical"
              />
            </div>
          </UTooltip>
        </div>
      </div>
    </aside>
    <div
      class="p-2 h-screen bg-white dark:bg-neutral-900 transition-all duration-300 overflow-hidden flex flex-col"
      :class="[isCollapsed ? 'sm:ml-15' : 'sm:ml-64']"
    >
      <FlexThreeColumn class="mb-2 flex-none">
        <template #left>
          <UDrawer
            class="sm:hidden"
            direction="left"
            as="aside"
            :handle="false"
          >
            <UButton
              icon="i-lucide-menu"
              class="w-8 h-8"
              color="neutral"
              variant="ghost"
            />
            <template #content>
              <div class="w-[60vw] p-4">
                <div class="mb-4">
                  <OrganizationSwitcher />
                </div>
                <UNavigationMenu
                  orientation="vertical"
                  :items="menus"
                  class="data-[orientation=vertical]:w-full"
                />
              </div>
            </template>
          </UDrawer>
          <UButton
            :icon="isCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            class="w-8 h-8 hidden sm:block"
            color="neutral"
            variant="ghost"
            @click="isCollapsed = !isCollapsed"
          />
          <title>{{ pathNameItemMap[$route.path]?.label }}</title>
          <h1>{{ pathNameItemMap[$route.path]?.label }} </h1>
          <slot name="navLeft" />
        </template>
        <template #middle>
          <slot name="navMiddle" />
        </template>
        <template #right>
          <slot name="navRight" />
          <LocaleToggler />
          <ClientOnly>
            <ColorModeToggler />
          </ClientOnly>
        </template>
      </FlexThreeColumn>
      <div class="p-2 border-2 border-neutral-200 border-dashed rounded-lg dark:border-neutral-700 flex-1 overflow-auto">
        <slot />
      </div>
    </div>

    <!-- Create Team Modal -->
    <UModal
      v-model:open="isCreateTeamModalOpen"
      title="Create New Team"
      description="Create a new team to collaborate with others."
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="Team Name"
            required
          >
            <UInput
              v-model="newTeamName"
              placeholder="Acme Inc"
              icon="i-lucide-building-2"
            />
          </UFormField>
          <UFormField
            label="Team URL (Slug)"
            required
            :error="slugError || undefined"
          >
            <UInput
              v-model="newTeamSlug"
              placeholder="acme-inc"
              icon="i-lucide-link"
              :loading="isCheckingSlug"
              @input="isSlugManuallyEdited = true"
              @keyup.enter="createTeam"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Unique identifier for your team URL.
            </p>
          </UFormField>

          <div
            v-if="showBilling"
            class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800"
          >
            <label class="block text-sm font-medium mb-3">Select plan</label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                class="border rounded-lg p-4 cursor-pointer transition-all"
                :class="selectedPlan === 'launch' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
                @click="selectedPlan = 'launch'"
              >
                <div class="flex justify-between items-start mb-2">
                  <h3 class="font-semibold">
                    Launch
                  </h3>
                  <UIcon
                    v-if="selectedPlan === 'launch'"
                    name="i-lucide-check-circle"
                    class="w-5 h-5 text-primary"
                  />
                  <div
                    v-else
                    class="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600"
                  />
                </div>
                <div class="text-2xl font-bold mb-1">
                  $5 <span class="text-sm font-normal text-muted-foreground">/ month</span>
                </div>
                <p class="text-xs text-muted-foreground mb-3">
                  minimum spend
                </p>

                <div class="space-y-2">
                  <p class="text-xs font-medium">
                    Included:
                  </p>
                  <ul class="text-xs space-y-1.5 text-muted-foreground">
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Free limits removed
                    </li>
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Autoscale to 16 CU
                    </li>
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Scale to zero after 5m
                    </li>
                  </ul>
                </div>
              </div>

              <div
                class="border rounded-lg p-4 cursor-pointer transition-all"
                :class="selectedPlan === 'scale' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
                @click="selectedPlan = 'scale'"
              >
                <div class="flex justify-between items-start mb-2">
                  <h3 class="font-semibold">
                    Scale
                  </h3>
                  <UIcon
                    v-if="selectedPlan === 'scale'"
                    name="i-lucide-check-circle"
                    class="w-5 h-5 text-primary"
                  />
                  <div
                    v-else
                    class="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600"
                  />
                </div>
                <div class="text-2xl font-bold mb-1">
                  $5 <span class="text-sm font-normal text-muted-foreground">/ month</span>
                </div>
                <p class="text-xs text-muted-foreground mb-3">
                  minimum spend
                </p>

                <div class="space-y-2">
                  <p class="text-xs font-medium">
                    Included:
                  </p>
                  <ul class="text-xs space-y-1.5 text-muted-foreground">
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Compute sizes up to 56 CU
                    </li>
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Configurable scale to zero
                    </li>
                    <li class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-check"
                        class="w-3 h-3 text-green-500"
                      /> Up to 1000 projects
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="isCreateTeamModalOpen = false"
        />
        <UButton
          :loading="creatingTeam"
          :disabled="!newTeamName.trim() || !newTeamSlug.trim()"
          label="Create Team"
          icon="i-lucide-plus-circle"
          @click="createTeam"
        />
      </template>
    </UModal>
  </div>
</template>
