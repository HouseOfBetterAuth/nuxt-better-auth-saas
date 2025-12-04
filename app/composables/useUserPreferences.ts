import { useLocalStorage } from '@vueuse/core'

export type ThemePreference = 'system' | 'light' | 'dark'

export function useUserPreferences() {
  const colorMode = useColorMode()
  const { locale, locales, setLocale } = useI18n()

  const themePreference = useLocalStorage<ThemePreference>('preferences.theme', colorMode.preference ?? 'system')
  watch(themePreference, (value) => {
    colorMode.preference = value
  }, { immediate: true })

  const interfaceLanguage = useLocalStorage<string>('preferences.interfaceLanguage', 'auto')
  const spokenLanguage = useLocalStorage<string>('preferences.spokenLanguage', 'auto')

  const availableLocaleCodes = computed(() => locales.value?.map(entry => entry.code) ?? [])

  const detectLocale = () => {
    const fallback = availableLocaleCodes.value[0] ?? 'en'
    if (!import.meta.client)
      return fallback

    const browserLanguages = [...(navigator.languages || []), navigator.language].filter(Boolean).map(lang => lang.toLowerCase())
    const match = browserLanguages.find(language => availableLocaleCodes.value.some((code) => {
      const normalizedCode = code.toLowerCase()
      return language === normalizedCode || language.startsWith(`${normalizedCode.split('-')[0]}`)
    }))

    return match
      ? availableLocaleCodes.value.find(code => match.startsWith(code.toLowerCase().split('-')[0])) || fallback
      : fallback
  }

  watch(interfaceLanguage, async (value) => {
    const targetLocale = value === 'auto' ? detectLocale() : value
    if (!targetLocale || locale.value === targetLocale)
      return

    await setLocale(targetLocale)
  }, { immediate: true })

  const resolvedInterfaceLanguage = computed(() => interfaceLanguage.value === 'auto' ? detectLocale() : interfaceLanguage.value)
  const resolvedSpokenLanguage = computed(() => spokenLanguage.value === 'auto' ? detectLocale() : spokenLanguage.value)

  const setThemePreference = (theme: ThemePreference) => {
    themePreference.value = theme
  }

  return {
    detectLocale,
    interfaceLanguage,
    resolvedInterfaceLanguage,
    resolvedSpokenLanguage,
    setThemePreference,
    spokenLanguage,
    themePreference,
    locales
  }
}
