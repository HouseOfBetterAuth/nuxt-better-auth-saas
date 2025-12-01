export const useDate = () => {
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()

  const activeTimezone = computed(() => {
    const data = activeOrg.value?.data
    if (!data?.metadata)
      return 'America/Detroit' // Default

    const meta = data.metadata
    try {
      const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
      if (parsed.timezone) {
        const tz = parsed.timezone
        return (typeof tz === 'object' && tz !== null) ? tz.value : tz.trim()
      }
    } catch {
      // Ignore parse error
    }
    return 'America/Detroit'
  })

  const formatDate = (date: string | Date, options?: Intl.DateTimeFormatOptions, timezoneOverride?: string) => {
    if (!date)
      return 'Never'

    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    }

    const tz = timezoneOverride || activeTimezone.value

    try {
      return new Date(date).toLocaleString('en-US', {
        ...(options || defaultOptions),
        timeZone: tz
      })
    } catch {
      // Fallback if timezone is invalid
      return new Date(date).toLocaleString('en-US', options || defaultOptions)
    }
  }

  return {
    formatDate,
    activeTimezone
  }
}
