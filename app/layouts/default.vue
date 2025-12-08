<script lang="ts" setup>
import OnboardingModal from '~/components/OnboardingModal.vue'
import UserNavigation from '~/components/UserNavigation.vue'

const { needsOnboarding, showOnboarding } = useOnboarding()
const { t } = useI18n()
const localePath = useLocalePath()

watch(() => needsOnboarding.value, (needs) => {
  if (needs)
    showOnboarding()
}, { immediate: true })

const i18nHead = useLocaleHead()
const route = useRoute()

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
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-gray-200/50 dark:border-gray-800/50 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm">
      <div class="px-4 py-3 flex items-center justify-between gap-3 max-w-3xl mx-auto w-full">
        <div class="flex-1 flex items-center justify-start min-w-0">
          <slot name="header-title">
            <h1
              v-if="pageTitle"
              class="text-lg font-semibold text-left truncate"
            >
              {{ pageTitle }}
            </h1>
          </slot>
        </div>
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
