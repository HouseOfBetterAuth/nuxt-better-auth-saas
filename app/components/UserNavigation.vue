<script setup lang="ts">
import { getPlanKeyFromId, PLAN_TIERS } from '~~/shared/utils/plans'

const localePath = useLocalePath()
const { t } = useI18n()
const { loggedIn, signOut, user, activeStripeSubscription } = useAuth()

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
      :items="[
        {
          label: t('global.auth.signOut'),
          icon: 'i-lucide-log-out',
          onSelect: () => signOut()
        }
      ]"
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
      variant="outline"
    >
      {{ t('global.auth.signIn') }}
    </UButton>
  </template>
</template>
