import { format, formatDistanceToNowStrict, isSameDay, isThisWeek, isThisYear, isYesterday } from 'date-fns'
import { formatInTimeZone, toZonedTime } from 'date-fns-tz'

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

  /**
   * Convert a date to represent the same moment in the target timezone
   * This is used for formatting and comparisons in the target timezone context
   */
  const toTimezoneDate = (date: string | Date, timezoneOverride?: string): Date => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (!dateObj || Number.isNaN(dateObj.getTime()))
      return new Date()

    const tz = timezoneOverride || activeTimezone.value
    try {
      // Convert UTC date to the target timezone representation
      return toZonedTime(dateObj, tz)
    } catch {
      return dateObj
    }
  }

  /**
   * Convert Intl.DateTimeFormatOptions to date-fns format string
   */
  const optionsToFormatString = (options: Intl.DateTimeFormatOptions): string => {
    const dateParts: string[] = []
    const timeParts: string[] = []

    // Month
    if (options.month === 'short') {
      dateParts.push('MMM')
    } else if (options.month === 'long') {
      dateParts.push('MMMM')
    } else if (options.month === 'numeric') {
      dateParts.push('M')
    } else if (options.month === '2-digit') {
      dateParts.push('MM')
    }

    // Day
    if (options.day === 'numeric') {
      dateParts.push('d')
    } else if (options.day === '2-digit') {
      dateParts.push('dd')
    }

    // Year
    if (options.year === 'numeric') {
      dateParts.push('yyyy')
    } else if (options.year === '2-digit') {
      dateParts.push('yy')
    }

    // Time components
    if (options.hour) {
      const hourFormat = options.hour === '2-digit' ? 'hh' : 'h'
      timeParts.push(hourFormat)
    }

    if (options.minute) {
      const minuteFormat = options.minute === '2-digit' ? 'mm' : 'm'
      timeParts.push(minuteFormat)
    }

    // AM/PM
    if (options.hour && options.hour12 !== false) {
      timeParts.push('a')
    }

    // Build format string with proper separators
    let formatStr = ''

    // Date part
    if (dateParts.length > 0) {
      if (dateParts.length === 3 && options.month === 'short') {
        // Format: "MMM d, yyyy" or "MMM d, yy"
        formatStr = `${dateParts[0]} ${dateParts[1]}, ${dateParts[2]}`
      } else {
        formatStr = dateParts.join(' ')
      }
    }

    // Time part
    if (timeParts.length > 0) {
      // Separate time components from AM/PM
      const hasAmPm = timeParts[timeParts.length - 1] === 'a'
      const timeComponents = hasAmPm ? timeParts.slice(0, -1) : timeParts
      const amPm = hasAmPm ? ' a' : ''

      // Join hour and minute with colon
      const timeStr = timeComponents.join(':') + amPm

      if (formatStr) {
        formatStr += ` ${timeStr}`
      } else {
        formatStr = timeStr
      }
    }

    return formatStr || 'PPpp' // Fallback to date-fns default format
  }

  /**
   * Format date with absolute formatting (original behavior)
   */
  const formatDate = (date: string | Date, options?: Intl.DateTimeFormatOptions, timezoneOverride?: string) => {
    if (!date)
      return 'Never'

    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (!dateObj || Number.isNaN(dateObj.getTime()))
      return 'Never'

    const tz = timezoneOverride || activeTimezone.value

    try {
      // Build format string from options
      const defaultOptions: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric'
      }

      const mergedOptions = { ...defaultOptions, ...options }
      const formatStr = optionsToFormatString(mergedOptions)

      return formatInTimeZone(dateObj, tz, formatStr)
    } catch {
      // Fallback if timezone is invalid or format fails
      try {
        return formatInTimeZone(dateObj, tz, 'M/d/yyyy, h:mm a')
      } catch {
        return new Date(dateObj).toLocaleString('en-US', options)
      }
    }
  }

  /**
   * Format date as relative time (e.g., "3m ago", "2 hours ago", "yesterday")
   * Relative time is calculated relative to the user's local "now" for accuracy
   */
  const formatRelativeTime = (date: string | Date | null | undefined, options?: { addSuffix?: boolean, timezoneOverride?: string }): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      // Calculate relative time using the actual date (not timezone-adjusted)
      // formatDistanceToNowStrict avoids filler words such as "about"
      return formatDistanceToNowStrict(dateObj, {
        addSuffix: options?.addSuffix !== false // Default to true
      })
    } catch {
      return '—'
    }
  }

  /**
   * Format date with smart switching between relative and absolute formats
   * Recent dates use relative time, older dates use absolute format
   */
  const formatDateRelative = (
    date: string | Date | null | undefined,
    options?: {
      mode?: 'auto' | 'relative' | 'absolute'
      timezoneOverride?: string
      includeTime?: boolean
    }
  ): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      const mode = options?.mode || 'auto'
      const tz = options?.timezoneOverride || activeTimezone.value

      // Force modes
      if (mode === 'relative') {
        return formatRelativeTime(date, { timezoneOverride: tz })
      }
      if (mode === 'absolute') {
        if (options?.includeTime) {
          return formatDate(date, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          }, tz)
        }
        return formatDate(date, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }, tz)
      }

      // Auto mode: smart switching
      // For comparisons, we need to check dates in the target timezone context
      const tzDate = toTimezoneDate(dateObj, tz)
      const nowInTz = toZonedTime(new Date(), tz)

      // Calculate hours difference using timezone-aware dates
      const hoursDiff = Math.abs(nowInTz.getTime() - tzDate.getTime()) / (1000 * 60 * 60)

      // Less than 24 hours: use relative time (calculated from actual date)
      if (hoursDiff < 24) {
        return formatRelativeTime(date, { timezoneOverride: tz })
      }

      // Check if it's today in the target timezone using date-fns functions
      const isTodayInTz = isSameDay(tzDate, nowInTz)
      const isYesterdayInTz = isYesterday(tzDate)

      // Today: "Today at 3:45 PM"
      if (isTodayInTz) {
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `Today at ${timeStr}`
      }

      // Yesterday: "Yesterday at 3:45 PM"
      if (isYesterdayInTz) {
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `Yesterday at ${timeStr}`
      }

      // This week: Check if within 7 days in target timezone
      if (isThisWeek(tzDate)) {
        const dayStr = format(tzDate, 'EEEE') // Day name
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `${dayStr} at ${timeStr}`
      }

      // This year: "Dec 9" or "Dec 9, 3:45 PM"
      if (isThisYear(tzDate)) {
        if (options?.includeTime) {
          return format(tzDate, 'MMM d, h:mm a')
        }
        return format(tzDate, 'MMM d')
      }

      // Older: Full date "Dec 9, 2024" or "Dec 9, 2024 at 3:45 PM"
      if (options?.includeTime) {
        return formatDate(date, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
      }
      return formatDate(date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }, tz)
    } catch {
      return '—'
    }
  }

  /**
   * Format date in short, compact format (e.g., "Dec 9" for current year, "Dec 9, 2024" for older)
   */
  const formatDateShort = (
    date: string | Date | null | undefined,
    options?: {
      timezoneOverride?: string
      includeTime?: boolean
    }
  ): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      const tz = options?.timezoneOverride || activeTimezone.value
      const tzDate = toTimezoneDate(dateObj, tz)
      const nowInTz = toZonedTime(new Date(), tz)

      // Check if same year in target timezone
      if (tzDate.getFullYear() === nowInTz.getFullYear()) {
        if (options?.includeTime) {
          return format(tzDate, 'MMM d, h:mm a')
        }
        return format(tzDate, 'MMM d')
      }

      // Older dates include year
      if (options?.includeTime) {
        return format(tzDate, 'MMM d, yyyy, h:mm a')
      }
      return format(tzDate, 'MMM d, yyyy')
    } catch {
      return '—'
    }
  }

  /**
   * Format date for list rows: Git-like relative time (e.g., "2 hours ago", "3 days ago", "2 weeks ago")
   * Falls back to short date for very old dates
   */
  const formatDateListStamp = (
    date: string | Date | null | undefined,
    options?: {
      timezoneOverride?: string
    }
  ): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      const tz = options?.timezoneOverride || activeTimezone.value
      const tzDate = toTimezoneDate(dateObj, tz)
      const nowInTz = toZonedTime(new Date(), tz)

      // Calculate time difference
      const diffMs = nowInTz.getTime() - tzDate.getTime()
      const isFuture = diffMs < 0
      const diffHours = Math.abs(diffMs) / (1000 * 60 * 60)
      const diffDays = Math.abs(diffMs) / (1000 * 60 * 60 * 24)

      // Less than 1 hour: show minutes
      if (diffHours < 1) {
        const diffMins = Math.floor(Math.abs(diffMs) / (1000 * 60))
        if (isFuture) {
          return diffMins <= 1 ? 'in a moment' : `in ${diffMins}m`
        }
        return diffMins <= 1 ? 'just now' : `${diffMins}m ago`
      }

      // Less than 24 hours: show hours
      if (diffHours < 24) {
        const hours = Math.floor(diffHours)
        return isFuture ? `in ${hours}h` : `${hours}h ago`
      }

      // Less than 7 days: show days
      if (diffDays < 7) {
        const days = Math.floor(diffDays)
        return isFuture ? `in ${days}d` : `${days}d ago`
      }

      // Less than 4 weeks: show weeks
      if (diffDays < 28) {
        const weeks = Math.floor(diffDays / 7)
        return isFuture ? `in ${weeks}w` : `${weeks}w ago`
      }

      // Less than 12 months: show months
      if (diffDays < 365) {
        const months = Math.floor(diffDays / 30)
        return isFuture ? `in ${months}mo` : `${months}mo ago`
      }

      // Older: show short date format (e.g., "Dec 5, 2024")
      return formatDateShort(dateObj, { timezoneOverride: tz })
    } catch {
      return '—'
    }
  }

  return {
    formatDate,
    formatRelativeTime,
    formatDateRelative,
    formatDateShort,
    formatDateListStamp,
    activeTimezone
  }
}
