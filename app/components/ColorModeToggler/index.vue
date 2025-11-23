<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
const colorMode = useColorMode()
const { t } = useI18n()

const toggleColorMode = () => {
  colorMode.preference = colorMode.value === 'light' ? 'dark' : 'light'
}
</script>

<template>
  <UButton
    :icon="colorMode.value === 'light' ? 'i-lucide-moon' : 'i-lucide-sun'"
    color="neutral"
    variant="ghost"
    :aria-label="t('colorModeToggler.ariaLabel')"
    @click="toggleColorMode"
  />
</template>
