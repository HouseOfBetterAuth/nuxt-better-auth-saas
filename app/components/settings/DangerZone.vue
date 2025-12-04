<script setup lang="ts">
/**
 * Danger Zone section for leaving or deleting organization
 *
 * Usage: <SettingsDangerZone />
 */
const { organization, useActiveOrganization, fetchSession, user } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { showOnboarding } = useOnboarding()

const leaveLoading = ref(false)
const deleteLoading = ref(false)

// Computed permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find((m: any) => m.userId === user.value!.id)
  return member?.role
})

const canLeaveTeam = computed(() => {
  // Owners cannot leave (must delete or transfer), others can
  return currentUserRole.value !== 'owner'
})

const canDeleteTeam = computed(() => {
  return currentUserRole.value === 'owner'
})

async function leaveTeam() {
  if (!activeOrg.value?.data?.id)
    return

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm(`Are you sure you want to leave "${activeOrg.value.data.name}"?`)
  if (!confirmed)
    return

  leaveLoading.value = true
  try {
    const { error } = await organization.leave({
      organizationId: activeOrg.value.data.id
    })
    if (error)
      throw error

    toast.add({ title: 'Left team successfully', color: 'success' })

    // Refresh and redirect
    const { data: orgs } = await organization.list()
    if (orgs && orgs.length > 0 && orgs[0]?.id && orgs[0]?.slug) {
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      await fetchSession()
      await showOnboarding()
      await navigateTo('/')
    }
  } catch (e: any) {
    toast.add({ title: 'Error leaving team', description: e.message, color: 'error' })
  } finally {
    leaveLoading.value = false
  }
}

async function deleteTeam() {
  if (!activeOrg.value?.data?.id)
    return

  const name = activeOrg.value.data.name
  // eslint-disable-next-line no-alert
  const confirmed = confirm(
    `Are you sure you want to delete "${name}"? This action cannot be undone and will remove all members and data.`
  )

  if (!confirmed)
    return

  deleteLoading.value = true

  try {
    const { error } = await organization.delete({
      organizationId: activeOrg.value.data.id
    })

    if (error)
      throw error

    toast.add({ title: 'Team deleted successfully', color: 'success' })

    // Fetch remaining teams to determine where to redirect
    const { data: orgs } = await organization.list()

    if (orgs && orgs.length > 0 && orgs[0]?.id && orgs[0]?.slug) {
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      await fetchSession()
      await showOnboarding()
      await navigateTo('/')
    }
  } catch (e: any) {
    toast.add({
      title: 'Error deleting team',
      description: e.message,
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Leave Team -->
    <div
      v-if="canLeaveTeam"
      class="border border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-900/10"
    >
      <h2 class="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
        Leave organization
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        Revoke your access to this organization. You will need to be re-invited to join again.
      </p>

      <UButton
        color="error"
        variant="outline"
        icon="i-lucide-log-out"
        :loading="leaveLoading"
        class="cursor-pointer"
        @click="leaveTeam"
      >
        Leave Team
      </UButton>
    </div>

    <!-- Delete Team -->
    <div
      v-if="canDeleteTeam"
      class="border border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-900/10"
    >
      <h2 class="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
        Delete organization
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        Once you delete a team, there is no going back. Please be certain.
      </p>

      <UButton
        color="error"
        variant="outline"
        icon="i-lucide-trash-2"
        :loading="deleteLoading"
        class="cursor-pointer"
        @click="deleteTeam"
      >
        Delete Team
      </UButton>
    </div>
  </div>
</template>
