<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
const { locale, setLocale, locales } = useI18n()
const { t } = useI18n()
const localeItems = computed(() => {
  return locales.value.map(item => ({
    label: item.name,
    type: 'checkbox' as const,
    checked: locale.value === item.code,
    onUpdateChecked: async (checked: boolean) => {
      if (checked) {
        await setLocale(item.code)
      }
    }
  }))
})
</script>

<template>
  <UDropdownMenu :items="localeItems">
    <UButton
      icon="i-lucide-languages"
      color="neutral"
      variant="ghost"
      class="w-8 h-8"
      :aria-label="t('localeToggler.ariaLabel')"
    />
  </UDropdownMenu>
</template>
