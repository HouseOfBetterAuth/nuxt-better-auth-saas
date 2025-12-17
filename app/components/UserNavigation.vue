<script setup lang="ts">
import { getPlanKeyFromId, PLAN_TIERS } from '~~/shared/utils/plans'

const emit = defineEmits<{
  signIn: [event: MouseEvent]
}>()
const localePath = useLocalePath()
const { t } = useI18n()
const route = useRoute()
const { loggedIn, signOut, user, useActiveOrganization } = useAuth()
const { activeSub: activeStripeSubscription } = usePaymentStatus()
const activeOrg = useActiveOrganization()

const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  if (routeSlug && routeSlug !== 't')
    return routeSlug
  const fallback = activeOrg.value?.data?.slug
  return fallback && fallback !== 't' ? fallback : null
})

const menuItems = computed(() => {
  const items: any[] = []
  if (orgSlug.value) {
    items.push({
      label: t('global.nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath(`/${orgSlug.value}/settings`)
    })
  }
  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })
  return items
})

// Get the tier display name from the subscription plan
const tierBadgeLabel = computed(() => {
  if (!activeStripeSubscription.value?.plan)
    return 'Pro'
  const tierKey = getPlanKeyFromId(activeStripeSubscription.value.plan)
  if (tierKey === 'free')
    return 'Pro' // Fallback
  return PLAN_TIERS[tierKey]?.name || 'Pro'
})
</script>

<template>
  <template v-if="loggedIn">
    <UDropdownMenu
      :items="menuItems"
    >
      <UButton
        variant="ghost"
        color="neutral"
        class="flex items-center gap-2"
      >
        <UAvatar
          v-if="user?.image"
          :src="user?.image"
          :alt="user?.name"
          size="sm"
        />
        <span>
          {{ user?.name }}
          <UBadge
            v-if="activeStripeSubscription"
            :label="tierBadgeLabel"
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
  </template>
  <template v-else>
    <UButton
      :to="localePath('/signin')"
      @click="emit('signIn', $event)"
    >
      {{ t('global.auth.signIn') }}
    </UButton>
  </template>
</template>
