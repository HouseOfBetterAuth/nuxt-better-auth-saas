export const htmlColumn = <T>(cell: ColumnCell<T>, el = 'span') => {
  const value = cell.getValue() as string
  return h(el, { innerHTML: value }, [])
}

export const IDColumn = <T>(cell: ColumnCell<T>) => {
  const value = cell.getValue() as string
  return h(UTooltip, {
    text: value,
    disableClosingTrigger: true
  }, () => h(
    'span',
    {},
    value.substring(0, 8)
  ))
}

export const showMoreColumn = <T>(cell: ColumnCell<T>, length: number) => {
  const value = cell.getValue() as string || ''
  if (value.length <= length) {
    return value
  }

  return h(UTooltip, {
    text: value,
    disableClosingTrigger: true
  }, () => h(
    'span',
    {},
    `${value.substring(0, length)}...`
  ))
}

/**
 * Creates a date column formatter that uses the provided formatDateShort function.
 * This factory function should be called in component setup to get a properly configured dateColumn.
 *
 * @param formatDateShort - The date formatting function from useDate() composable
 * @returns A cell renderer function for date columns
 */
export const createDateColumn = <T>(
  formatDateShort: (value: Date | string, options?: { includeTime?: boolean }) => string
) => {
  return (cell: ColumnCell<T>) => {
    const value = cell.getValue() as Date | string
    return formatDateShort(value, { includeTime: true })
  }
}

/**
 * @deprecated Use createDateColumn() instead. This function cannot access composables.
 * Kept for backward compatibility but will use a fallback formatter.
 */
export const dateColumn = <T>(cell: ColumnCell<T>) => {
  const value = cell.getValue() as Date | string
  const date = new Date(value)

  // Handle invalid dates
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  // Fallback formatter when composable is not available
  // Use browser's default locale if available, otherwise fallback to en-US
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'

  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export const yesNoColumn = <T>(cell: ColumnCell<T>, t: TranFunction) => {
  const value = cell.getValue() as boolean
  const color = value ? 'success' : 'error'
  return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () => value ? t('yes') : t('no'))
}

export const avatarColumn = <T>(cell: ColumnCell<T>) => {
  const value = cell.getValue() as string
  return h(UAvatar, { src: value })
}

export const isEnabledColumn = <T>(cell: ColumnCell<T>, t: TranFunction) => {
  const value = cell.getValue() as boolean
  const color = value ? 'success' : 'error'
  return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () => value ? t('enable') : t('disable'))
}

export const actionColumn = <T>(row: Row<T>, getRowItems: (row: Row<T>) => any[]) => {
  return h(
    'div',
    { class: 'text-right' },
    h(
      UDropdownMenu as any,
      {
        content: {
          align: 'end'
        },
        items: getRowItems(row)
      },
      () => h(UButton, {
        icon: 'i-lucide-ellipsis-vertical',
        color: 'neutral',
        variant: 'ghost',
        class: 'ml-auto'
      })
    )
  )
}
