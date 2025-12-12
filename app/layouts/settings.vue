<script lang="ts" setup>
import Logo from '~/components/Logo.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import OrganizationSwitcher from '~/components/OrganizationSwitcher.vue'
import UserNavigation from '~/components/UserNavigation.vue'
import { getUserMenus } from '~/layouts/menu'

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { user, useActiveOrganization, activeOrgExtras, refreshActiveOrganizationExtras } = useAuth()
const activeOrg = useActiveOrganization()

// Get organization slug from route
const slug = computed(() => {
  const param = route.params.slug
  return Array.isArray(param) ? param[0] : param || ''
})

const i18nHead = useLocaleHead()

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))

// Page title state - pages can set this via provide
const headerTitle = useState<string | null>('page-header-title', () => null)

// Reset header title on route change
watch(() => route.path, () => {
  headerTitle.value = null
})

// Simple page title
const pageTitle = computed(() => {
  // If page explicitly set title, use it
  if (headerTitle.value) {
    return headerTitle.value
  }

  // Home page always shows "Quillio"
  if (route.path === '/' || route.path === localePath('/')) {
    return t('global.appName')
  }

  return null
})

// Provide function for pages to set header title
provide('setHeaderTitle', (title: string | null) => {
  headerTitle.value = title
})

// Get user role for menu permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find((m: any) => m.userId === user.value!.id)
  return member?.role || null
})

// Check if upgrade is needed
const needsUpgrade = computed(() => activeOrgExtras.value?.needsUpgrade ?? false)

// Get menu items for the drawer - reactive to org data changes
const menus = computed(() => {
  const role = currentUserRole.value as 'owner' | 'admin' | 'member' | null | undefined
  const menuItems = getUserMenus(localePath, slug.value, role, needsUpgrade.value)
  return menuItems
})
</script>

<template>
  <div class="min-h-screen flex flex-col relative">
    <header class="border-b border-neutral-200/70 dark:border-neutral-800/60 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm">
      <div class="px-4 py-3 flex items-center gap-3 max-w-3xl mx-auto w-full">
        <!-- Hamburger Menu (Left) -->
        <USlideover
          side="left"
          :handle="false"
        >
          <UButton
            icon="i-lucide-menu"
            class="w-8 h-8"
            color="neutral"
            variant="ghost"
          />
          <template #content>
            <div class="w-[60vw] max-w-sm h-full flex flex-col p-4 overflow-hidden">
              <!-- Logo and App Name -->
              <NuxtLink
                :to="localePath('/')"
                class="flex items-center gap-2 mb-4 shrink-0 min-w-0 hover:opacity-80 transition-opacity"
              >
                <Logo class="h-6 w-6 shrink-0" />
                <span class="text-xl font-semibold whitespace-nowrap dark:text-white truncate">
                  {{ t('global.appNameShort') }}
                </span>
              </NuxtLink>
              <!-- Organization Switcher -->
              <div class="mb-4 shrink-0 min-w-0">
                <OrganizationSwitcher />
              </div>
              <!-- Navigation Menu -->
              <div class="flex-1 min-h-0 overflow-y-auto">
                <UNavigationMenu
                  orientation="vertical"
                  :items="menus"
                  class="data-[orientation=vertical]:w-full"
                />
              </div>
            </div>
          </template>
        </USlideover>

        <!-- Title (Center) -->
        <div class="flex-1 flex items-center justify-center min-w-0">
          <slot name="header-title">
            <h1
              v-if="pageTitle"
              class="text-lg font-semibold text-center truncate"
            >
              {{ pageTitle }}
            </h1>
          </slot>
        </div>

        <!-- User Navigation (Right) -->
        <div class="flex items-center gap-2">
          <UserNavigation />
        </div>
      </div>
    </header>

    <main class="flex-1 w-full">
      <div class="max-w-3xl mx-auto w-full px-4">
        <slot />
      </div>
    </main>
    <OnboardingModal />
  </div>
</template>
