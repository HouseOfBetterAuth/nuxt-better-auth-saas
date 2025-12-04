<script setup lang="ts">
import type { ThemePreference } from '~/composables/useUserPreferences'

definePageMeta({
  layout: 'dashboard'
})

const {
  interfaceLanguage,
  locales,
  resolvedInterfaceLanguage,
  resolvedSpokenLanguage,
  setThemePreference,
  spokenLanguage,
  themePreference
} = useUserPreferences()

const themeOptions: { label: string, value: ThemePreference }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' }
]

const languageOptions = computed(() => [
  { label: 'Auto-detect', value: 'auto' },
  ...(locales.value || []).map(locale => ({
    label: locale.name,
    value: locale.code
  }))
])

const spokenLanguageOptions = computed(() => [
  { label: 'Auto-detect', value: 'auto' },
  ...(locales.value || []).map(locale => ({
    label: locale.name,
    value: locale.code
  }))
])

const activeTheme = computed({
  get: () => themePreference.value,
  set: value => setThemePreference(value as ThemePreference)
})
</script>

<template>
  <UContainer class="py-10">
    <div class="max-w-5xl mx-auto space-y-8">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="space-y-1">
          <h1 class="text-3xl font-semibold">
            General
          </h1>
          <p class="text-muted-500">
            Control the basics for your workspace experience like appearance and language defaults.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <LocaleToggler />
          <ClientOnly>
            <ColorModeToggler />
          </ClientOnly>
        </div>
      </div>

      <UCard class="space-y-6">
        <div class="space-y-1">
          <h2 class="text-xl font-semibold">
            Appearance
          </h2>
          <p class="text-sm text-muted-500">
            Pick a theme that fits where you embed the widget.
          </p>
        </div>

        <div class="space-y-3">
          <p class="text-sm font-medium text-muted-700">
            Theme
          </p>
          <URadioGroup
            v-model="activeTheme"
            :options="themeOptions"
            class="grid grid-cols-3 gap-2 md:w-1/2"
            :ui="{ item: 'w-full' }"
          />
        </div>
      </UCard>

      <UCard class="space-y-6">
        <div class="space-y-1">
          <h2 class="text-xl font-semibold">
            Language
          </h2>
          <p class="text-sm text-muted-500">
            Select the language used for the interface or let us auto-detect it.
          </p>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <UFormField label="Language">
            <USelect
              v-model="interfaceLanguage"
              placeholder="Select language"
              :items="languageOptions"
            />
            <p class="text-xs text-muted-500 mt-1">
              We use {{ interfaceLanguage === 'auto' ? 'auto-detection' : 'your selection' }} to render the UI. Active: {{ resolvedInterfaceLanguage }}
            </p>
          </UFormField>

          <UFormField label="Spoken language">
            <USelect
              v-model="spokenLanguage"
              placeholder="Select spoken language"
              :items="spokenLanguageOptions"
            />
            <p class="text-xs text-muted-500 mt-1">
              For best results, choose the language you mainly speak. If it's not listed, auto-detection may still work.
            </p>
            <p class="text-xs text-muted-400">
              Active preference: {{ resolvedSpokenLanguage }}
            </p>
          </UFormField>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
