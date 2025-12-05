import { useLocalStorage } from '@vueuse/core'

export type ThemePreference = 'system' | 'light' | 'dark'

export function useUserPreferences() {
  const colorMode = useColorMode()
  const { locale, locales, setLocale } = useI18n()

  const themePreference = useLocalStorage<ThemePreference>('preferences.theme', (colorMode.preference ?? 'system') as ThemePreference)
  watch(themePreference, (value) => {
    colorMode.preference = value
  }, { immediate: true })

  const interfaceLanguage = useLocalStorage<string>('preferences.interfaceLanguage', 'auto')
  const spokenLanguage = useLocalStorage<string>('preferences.spokenLanguage', 'auto')

  type LocaleCode = typeof locale.value
  const defaultLocale = locale.value

  // First, compute available locale codes using a simple string filter
  const availableLocaleCodes = computed(() =>
    (locales.value ?? [])
      .map(entry => entry.code)
      .filter((code): code is LocaleCode => typeof code === 'string' && code.length > 0)
  )

  // Stronger type guard that validates against actual available locale codes
  const _isLocaleCode = (code: unknown): code is LocaleCode =>
    typeof code === 'string' && availableLocaleCodes.value.includes(code as LocaleCode)

  const detectLocale = (): LocaleCode => {
    const fallback = availableLocaleCodes.value[0] ?? defaultLocale
    if (!import.meta.client)
      return fallback

    const browserLanguages = [...(navigator.languages || []), navigator.language].filter(Boolean).map((lang: string) => lang.toLowerCase())
    const match = browserLanguages.find((language: string) => availableLocaleCodes.value.some((code: LocaleCode) => {
      const normalizedCode = code.toLowerCase()
      return language === normalizedCode || language.startsWith(`${normalizedCode.split('-')[0]}`)
    }))

    if (!match)
      return fallback

    const foundCode = availableLocaleCodes.value.find((code: LocaleCode) => {
      const parts = code.toLowerCase().split('-')
      const codePrefix = parts[0]
      if (!codePrefix)
        return false
      return match.startsWith(codePrefix)
    })
    return foundCode ?? fallback
  }

  watch(interfaceLanguage, async (value) => {
    const targetLocale = value === 'auto' ? detectLocale() : value
    if (!targetLocale || locale.value === targetLocale)
      return

    const fallback = availableLocaleCodes.value[0] ?? defaultLocale
    // Validate against available locale codes to ensure only valid locales are used
    const normalizedTarget = availableLocaleCodes.value.includes(targetLocale as LocaleCode) ? targetLocale as LocaleCode : null
    const validLocale = normalizedTarget ?? fallback
    await setLocale(validLocale)
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
