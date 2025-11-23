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

export const dateColumn = <T>(cell: ColumnCell<T>) => {
  const value = cell.getValue() as Date | string
  return formatToDatetime(value)
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
