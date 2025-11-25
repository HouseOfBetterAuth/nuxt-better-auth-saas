import type { LocalePathFunction } from '#i18n'

export const getMenus = (t: TranFunction, localePath: LocalePathFunction, appRepo: string): NavigationMenuItem[][] => {
  return [
    [
      {
        label: t('menu.dashboard'),
        icon: 'i-lucide-layout-dashboard',
        to: localePath('/admin/dashboard')
      },
      {
        label: t('menu.users'),
        icon: 'i-lucide-users',
        to: localePath('/admin/user')
      },
      {
        label: t('menu.subscriptions'),
        icon: 'i-lucide-credit-card',
        to: localePath('/admin/subscription')
      },
      {
        label: t('menu.files'),
        icon: 'i-lucide-folder',
        to: localePath('/admin/file')
      },
      {
        label: t('menu.maintenance'),
        icon: 'i-lucide-wrench',
        children: [
          {
            label: t('menu.auditLog'),
            icon: 'i-lucide-history',
            to: localePath('/admin/maintenance/audit-log')
          },
          {
            label: t('menu.dbStats'),
            icon: 'i-lucide-database',
            to: localePath('/admin/maintenance/db-stats')
          },
          {
            label: t('menu.migration'),
            icon: 'i-lucide-database-zap',
            to: localePath('/admin/maintenance/migration')
          }
        ]
      }
    ],
    [
      {
        label: t('menu.home'),
        icon: 'i-lucide-home',
        to: localePath('/')
      },
      {
        label: 'GitHub',
        icon: 'i-lucide-github',
        to: appRepo,
        target: '_blank'
      }
    ]
  ]
}

export const getUserMenus = (t: TranFunction, localePath: LocalePathFunction, appRepo: string, slug: string, canManage = false): NavigationMenuItem[][] => {
  const items: NavigationMenuItem[] = [
    {
      label: t('menu.dashboard'),
      icon: 'i-lucide-layout-dashboard',
      to: localePath(`/${slug}/dashboard`)
    },
    {
      label: 'Chat',
      icon: 'i-lucide-message-circle',
      to: localePath(`/${slug}/chat`)
    },
    {
      label: 'Members',
      icon: 'i-lucide-users',
      to: localePath(`/${slug}/members`)
    }
  ]

  if (canManage) {
    items.push({
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: localePath(`/${slug}/settings`)
    })
  }

  return [
    items,
    [
      {
        label: t('menu.home'),
        icon: 'i-lucide-home',
        to: localePath('/')
      }
    ]
  ]
}
