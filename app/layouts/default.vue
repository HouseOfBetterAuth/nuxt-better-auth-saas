<script lang="ts" setup>
import AppFooter from './components/AppFooter.vue'
import AppNavbar from './components/AppNavbar.vue'

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
    <div class="flex-1 pt-16 w-full">
      <slot />
    </div>
    <AppFooter />
  </div>
</template>
