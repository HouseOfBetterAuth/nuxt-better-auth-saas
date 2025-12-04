<script lang="ts" setup>
import OnboardingModal from '~/components/OnboardingModal.vue'
import AppNavbar from './components/AppNavbar.vue'

const { needsOnboarding, showOnboarding } = useOnboarding()

watch(() => needsOnboarding.value, (needs) => {
  if (needs) {
    showOnboarding()
  }
}, { immediate: true })

const i18nHead = useLocaleHead()
useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col relative">
    <AppNavbar>
      <template #center>
        <slot name="nav-center" />
      </template>
      <template #right>
        <slot name="nav-right" />
      </template>
    </AppNavbar>
    <div class="flex-1 pt-14 w-full">
      <slot />
    </div>
    <OnboardingModal />
  </div>
</template>
