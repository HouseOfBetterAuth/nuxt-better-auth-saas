<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const slug = computed(() => {
  const param = route.params.slug
  return Array.isArray(param) ? param[0] : param || ''
})

const { organization, useActiveOrganization, fetchSession, user } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()
const { showOnboarding } = useOnboarding()

interface ActiveOrgMember {
  userId?: string | null
  role?: string | null
}

// Computed permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find((m: ActiveOrgMember) => m.userId === user.value!.id)
  return member?.role
})

const canUpdateSettings = computed(() => {
  return currentUserRole.value === 'owner' || currentUserRole.value === 'admin'
})

const canDeleteTeam = computed(() => {
  return currentUserRole.value === 'owner'
})

// Leave team logic
const leaveLoading = ref(false)
const canLeaveTeam = computed(() => {
  // Owners cannot leave (must delete or transfer), others can
  return currentUserRole.value !== 'owner'
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
    const { data } = await organization.list()
    const orgs = Array.isArray(data) ? data : []
    const nextOrg = orgs[0]

    if (nextOrg) {
      await organization.setActive({ organizationId: nextOrg.id })
      await fetchSession()
      window.location.href = `/${nextOrg.slug}/dashboard`
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

// Organization data is already available via useActiveOrganization()
// No need to fetch it again on page load
const loading = ref(false)
const teamName = ref('')
const teamSlug = ref('')

// Initialize fields immediately from preloaded data or activeOrg
if (activeOrg.value?.data) {
  teamName.value = activeOrg.value.data.name
  teamSlug.value = activeOrg.value.data.slug
}

// Better watcher: Watch ID changes to handle switching
watch(() => activeOrg.value?.data?.id, (newId) => {
  if (newId && activeOrg.value?.data) {
    teamName.value = activeOrg.value.data.name
    teamSlug.value = activeOrg.value.data.slug
  }
}, { immediate: true })

async function updateTeam() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const { error } = await organization.update({
      organizationId: activeOrg.value.data.id,
      data: {
        name: teamName.value,
        slug: teamSlug.value
      }
    })

    if (error)
      throw error

    toast.add({ title: 'Team updated successfully', color: 'success' })

    // Refresh data
    await useAuth().fetchSession()

    // If slug changed, we must redirect to new URL
    // Otherwise reload is fine, but redirection is safer
    window.location.href = `/${teamSlug.value}/settings`
  } catch (e: any) {
    toast.add({
      title: 'Error updating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const copied = ref(false)
const copyId = () => {
  if (activeOrg.value?.data?.id) {
    copy(activeOrg.value.data.id)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
    toast.add({ title: 'Copied to clipboard' })
  }
}

const deleteLoading = ref(false)
async function deleteTeam() {
  if (!activeOrg.value?.data?.id)
    return

  const name = activeOrg.value.data.name
  // TODO: Replace with proper modal confirmation
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
    const { data } = await organization.list()
    const orgs = Array.isArray(data) ? data : []
    const nextOrg = orgs[0]

    if (nextOrg) {
      // Switch to first available team
      await organization.setActive({ organizationId: nextOrg.id })
      await fetchSession()
      window.location.href = `/${nextOrg.slug}/dashboard`
    } else {
      // No teams left
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
  <UContainer class="py-10">
    <div class="max-w-5xl mx-auto space-y-8">
      <div class="space-y-2">
        <h1 class="text-3xl font-semibold">
          Organization settings
        </h1>
        <p class="text-muted-500">
          Manage your team details, access, and integrations from a single place.
        </p>
      </div>

      <UCard
        v-if="canUpdateSettings"
        class="space-y-6"
      >
        <div class="space-y-1">
          <h2 class="text-xl font-semibold">
            General information
          </h2>
          <p class="text-sm text-muted-500">
            For billing purposes you can use the organization ID below.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UFormField label="Organization name">
            <UInput v-model="teamName" />
          </UFormField>
          <UFormField label="Organization slug">
            <UInput
              v-model="teamSlug"
              readonly
              icon="i-lucide-link"
            />
          </UFormField>
        </div>

        <UFormField label="Organization ID">
          <div class="flex gap-2">
            <UInput
              :model-value="activeOrg?.data?.id"
              readonly
              class="flex-1 font-mono text-sm bg-gray-50 dark:bg-gray-800"
            />
            <UButton
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="ghost"
              @click="copyId"
            />
          </div>
        </UFormField>

        <div class="flex justify-end">
          <UButton
            label="Save"
            color="primary"
            :loading="loading"
            @click="updateTeam"
          />
        </div>
      </UCard>

      <UCard
        v-if="canUpdateSettings"
        class="space-y-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-xl font-semibold">
              Integrations
            </h2>
            <p class="text-sm text-muted-500">
              Manage YouTube access and future provider connections for automated ingest.
            </p>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-arrow-up-right"
            :to="`/${slug}/integrations`"
          >
            Manage integrations
          </UButton>
        </div>
      </UCard>

      <div class="grid gap-4 md:grid-cols-2">
        <UCard
          v-if="canLeaveTeam"
          class="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10"
        >
          <div class="space-y-3">
            <h2 class="text-xl font-semibold text-red-600 dark:text-red-400">
              Leave organization
            </h2>
            <p class="text-sm text-muted-500">
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
        </UCard>

        <UCard
          v-if="canDeleteTeam"
          class="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10"
        >
          <div class="space-y-3">
            <h2 class="text-xl font-semibold text-red-600 dark:text-red-400">
              Delete organization
            </h2>
            <p class="text-sm text-muted-500">
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
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
