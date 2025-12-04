<script lang="ts" setup>
import OnboardingModal from '~/components/OnboardingModal.vue'
import OrganizationSwitcher from '~/components/OrganizationSwitcher.vue'
import UserNavigation from '~/components/UserNavigation.vue'
import Logo from '~/components/Logo.vue'

const { needsOnboarding, showOnboarding } = useOnboarding()
const { t } = useI18n()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const { data: userOrganizations } = useUserOrganizations({ lazy: true })

const hasOrganizations = computed(() => (userOrganizations.value?.length ?? 0) > 0)

const primaryOrgSlug = computed(() => {
  if (activeOrg.value?.data?.slug)
    return activeOrg.value.data.slug
  return userOrganizations.value?.[0]?.slug || null
})

const navItems = computed(() => {
  const items = [
    { label: 'Home', icon: 'i-lucide-home', to: localePath('/') },
    { label: 'Pricing', icon: 'i-lucide-badge-dollar-sign', to: localePath('/pricing') }
  ]
  const slug = primaryOrgSlug.value
  if (slug) {
    items.push(
      { label: 'Workspace', icon: 'i-lucide-layout-dashboard', to: localePath(`/${slug}/dashboard`) },
      { label: 'Members', icon: 'i-lucide-users', to: localePath(`/${slug}/members`) },
      { label: 'Settings', icon: 'i-lucide-settings', to: localePath(`/${slug}/settings`) }
    )
  }
  return items
})

watch(() => needsOnboarding.value, (needs) => {
  if (needs)
    showOnboarding()
}, { immediate: true })

const i18nHead = useLocaleHead()
useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    <header class="border-b border-neutral-200/70 dark:border-neutral-800/60 bg-background/90 backdrop-blur-sm">
      <div class="px-4 py-3 flex items-center gap-3 max-w-screen-sm mx-auto w-full">
        <UDrawer
          side="left"
          :ui="{ width: 'max-w-xs w-full' }"
        >
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-menu"
            aria-label="Open navigation"
          />
          <template #content>
            <div class="p-5 space-y-6">
              <div class="flex items-center gap-3">
                <Logo class="w-8 h-8" />
                <div>
                  <p class="font-semibold">
                    {{ t('global.appName') }}
                  </p>
                  <p class="text-sm text-muted-foreground">
                    Plan, write, and ship.
                  </p>
                </div>
              </div>

              <OrganizationSwitcher v-if="hasOrganizations" />

              <nav class="space-y-2">
                <UButton
                  v-for="item in navItems"
                  :key="item.to"
                  class="w-full justify-start"
                  color="neutral"
                  variant="ghost"
                  :to="item.to"
                >
                  <UIcon
                    v-if="item.icon"
                    :name="item.icon"
                    class="w-4 h-4 mr-2"
                  />
                  {{ item.label }}
                </UButton>
              </nav>

              <div class="pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <UserNavigation />
              </div>
            </div>
          </template>
        </UDrawer>
        <NuxtLink
          :to="localePath('/')"
          class="flex items-center gap-2 font-semibold text-lg"
        >
          <Logo class="w-6 h-6" />
          <span>{{ t('global.appName') }}</span>
        </NuxtLink>
      </div>
    </header>

    <main class="flex-1 w-full">
      <div class="max-w-screen-sm mx-auto w-full">
        <slot />
      </div>
    </main>

    <OnboardingModal />

  </div>
</template>
