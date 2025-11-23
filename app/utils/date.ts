import { CalendarDate, getLocalTimeZone } from '@internationalized/date'
import { endOfDay, format, parseISO, startOfDay } from 'date-fns'

export const DATE_FORMAT = 'yyyy-MM-dd'
export const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss'

export const getTimeZone = () => {
  const timezone = getLocalTimeZone()
  return timezone
}

export const formatDate = (date: Date | undefined) => {
  if (!date) {
    return ''
  }
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export const toCalendarDate = (date: Date) => {
  return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export const toDate = (calendarDate: CalendarDate) => {
  const timezone = getLocalTimeZone()
  return calendarDate.toDate(timezone)
}

export const formatToDate = (value: CalendarDate | Date | string) => {
  let date
  if (value instanceof CalendarDate) {
    const timezone = getLocalTimeZone()
    date = value.toDate(timezone)
  } else if (value instanceof Date) {
    date = value
  } else {
    // 2024-12-27T06:11:35.707+00:00
    // 2024-12-27T06:11:35.707123+00:00
    date = parseISO(value)
  }
  return date
}

export const formatToDay = (value: CalendarDate | Date | string) => {
  const date = formatToDate(value)
  return format(date, DATE_FORMAT)
}

export const formatToDatetime = (value: CalendarDate | Date | string | undefined) => {
  if (!value) {
    return ''
  }
  const date = formatToDate(value)
  return format(date, DATETIME_FORMAT)
}

export const startOfDate = (date: CalendarDate | Date) => {
  if (date instanceof CalendarDate) {
    const timezone = getLocalTimeZone()
    return startOfDay(date.toDate(timezone))
  } else {
    return startOfDay(date)
  }
}

export const endOfDate = (date: CalendarDate | Date) => {
  if (date instanceof CalendarDate) {
    const timezone = getLocalTimeZone()
    return endOfDay(date.toDate(timezone))
  } else {
    return endOfDay(date)
  }
}
