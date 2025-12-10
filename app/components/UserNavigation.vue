<script setup lang="ts">
interface ConversationQuotaUsagePayload {
  limit: number | null
  used: number | null
  remaining: number | null
  label?: string | null
  unlimited?: boolean | null
}

const localePath = useLocalePath()
const { t } = useI18n()
const { loggedIn, signOut, user, activeStripeSubscription, organization, session } = useAuth()
const sharedQuotaUsage = useState<ConversationQuotaUsagePayload | null>('conversation-quota-usage', () => null)

const userInitials = computed(() => {
  if (user.value?.name) {
    return user.value.name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (user.value?.email) {
    return user.value.email.charAt(0).toUpperCase()
  }

  return '?'
})

const userAvatar = computed(() => {
  const data = user.value as Record<string, any> | null
  return data?.image || data?.avatar || data?.avatarUrl || data?.picture || null
})

// Use shared composable with proper caching
const { data: organizations } = useUserOrganizations({ lazy: true })

// Get active organization slug from session's activeOrganizationId
// This works on all pages since better-auth maintains the active org in session
const activeOrgSlug = computed(() => {
  if (session.value?.activeOrganizationId && organizations.value) {
    const org = organizations.value.find((o: any) => o.id === session.value?.activeOrganizationId)
    if (org?.slug) {
      return org.slug
    }
  }
  return null
})

// Get settings route - only show if we have an org slug
const settingsRoute = computed(() => {
  const slug = activeOrgSlug.value
  if (!slug) {
    return null
  }
  return localePath(`/${slug}/settings`)
})

// Build dropdown items conditionally
const dropdownItems = computed(() => {
  const items: any[] = []

  if (settingsRoute.value) {
    items.push({
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: settingsRoute.value
    })
  }

  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })

  return items
})

const quotaBadgeLabel = computed(() => {
  const usage = sharedQuotaUsage.value
  if (usage?.unlimited)
    return '∞'
  if (!usage || typeof usage.limit !== 'number')
    return null
  const limit = Math.max(0, usage.limit)
  const used = Math.max(0, usage.used ?? (limit - (usage.remaining ?? 0)))
  return `${Math.min(used, limit)}/${limit}`
})

const quotaBadgeTooltip = computed(() => {
  if (!quotaBadgeLabel.value)
    return ''
  const label = sharedQuotaUsage.value?.label ?? (loggedIn.value ? 'Current plan' : 'Guest access')
  if (sharedQuotaUsage.value?.unlimited)
    return `${label}: Unlimited conversations`
  return `${label}: ${quotaBadgeLabel.value} conversations`
})

const emitQuotaEvent = () => {
  if (!quotaBadgeLabel.value || !import.meta.client) {
    return
  }
  const usage = sharedQuotaUsage.value
  window.dispatchEvent(new CustomEvent('quillio:show-quota', {
    detail: {
      limit: usage?.limit ?? null,
      used: usage?.used ?? null,
      remaining: usage?.remaining ?? null,
      label: usage?.label ?? (loggedIn.value ? 'Current plan' : 'Guest access'),
      unlimited: usage?.unlimited ?? false
    }
  }))
}
</script>

<template>
  <template v-if="loggedIn">
    <div class="flex items-center gap-2">
      <UBadge
        v-if="quotaBadgeLabel"
        color="primary"
        variant="soft"
        class="cursor-pointer select-none font-mono text-[11px] h-9 px-4 flex items-center"
        :title="quotaBadgeTooltip || undefined"
        @click="emitQuotaEvent"
      >
        {{ quotaBadgeLabel }}
      </UBadge>
      <UDropdownMenu
        :items="dropdownItems"
      >
        <UButton
          variant="ghost"
          color="neutral"
          class="flex items-center gap-2"
        >
          <UAvatar
            :src="userAvatar || undefined"
            :alt="user?.name || user?.email || 'User avatar'"
            size="sm"
          >
            <template
              v-if="!userAvatar"
              #fallback
            >
              <span class="text-xs font-medium">{{ userInitials }}</span>
            </template>
          </UAvatar>
          <span>
            {{ user?.name }}
            <UBadge
              v-if="activeStripeSubscription"
              label="Pro"
            />
          </span>
        </UButton>
      </UDropdownMenu>
      <UButton
        v-if="user?.role == 'admin'"
        variant="outline"
        color="neutral"
        class="flex items-center gap-2"
        :to="localePath('/admin')"
      >
        {{ t('global.nav.admin') }}
      </UButton>
    </div>
  </template>
  <template v-else>
    <div class="flex items-center gap-2">
      <UBadge
        v-if="quotaBadgeLabel"
        color="primary"
        variant="soft"
        class="cursor-pointer select-none font-mono text-[11px] h-9 px-4 flex items-center"
        :title="quotaBadgeTooltip || undefined"
        @click="emitQuotaEvent"
      >
        {{ quotaBadgeLabel }}
      </UBadge>
      <UButton
        :to="localePath('/signin')"
        color="primary"
        class="h-9 px-4"
      >
        {{ t('global.auth.signIn') }}
      </UButton>
    </div>
  </template>
</template>
