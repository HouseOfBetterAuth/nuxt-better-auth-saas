<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { canUpdateOrgSettings } from '~~/shared/utils/permissions'

definePageMeta({
  layout: 'dashboard'
})

const { organization, useActiveOrganization, fetchSession, user, client } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

// API Keys State
const apiKeys = ref<any[]>([])
const apiKeysLoading = ref(false)
const isCreateKeyModalOpen = ref(false)
const newKeyName = ref('')
const newKeyExpiresIn = ref<number | undefined>(undefined) // Default never? or 30 days?
const createdKey = ref<string | null>(null)
const createKeyLoading = ref(false)

// Sessions State
const sessions = ref<any[]>([])
const sessionsLoading = ref(false)
const showAllSessions = ref(false)

const displayedSessions = computed(() => {
  if (showAllSessions.value)
    return sessions.value
  return sessions.value.slice(0, 4)
})

function parseUserAgent(ua: string) {
  if (!ua)
    return { browser: 'Unknown', os: 'Unknown', icon: 'i-lucide-help-circle' }

  let browser = 'Unknown Browser'
  let os = 'Unknown OS'
  let icon = 'i-lucide-monitor' // Default to desktop

  // Detect Browser
  if (ua.includes('Firefox'))
    browser = 'Firefox'
  else if (ua.includes('Chrome'))
    browser = 'Chrome'
  else if (ua.includes('Safari'))
    browser = 'Safari'
  else if (ua.includes('Edge'))
    browser = 'Edge'

  // Detect OS
  if (ua.includes('Win')) {
    os = 'Windows'
  }
  else if (ua.includes('Mac')) {
    os = 'macOS'
  }
  else if (ua.includes('Linux')) {
    os = 'Linux'
  }
  else if (ua.includes('Android')) {
    os = 'Android'
    icon = 'i-lucide-smartphone'
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS'
    icon = 'i-lucide-smartphone'
  }

  return { browser, os, icon }
}

async function fetchSessions() {
  sessionsLoading.value = true
  try {
    const { data } = await client.listSessions()
    if (data) {
      const currentToken = useAuth().session.value?.token
      sessions.value = data
        .map((s: any) => {
          const { browser, os, icon } = parseUserAgent(s.userAgent)
          return {
            ...s,
            isCurrent: s.token === currentToken,
            browser,
            os,
            icon
          }
        })
        .sort((a: any, b: any) => {
          if (a.isCurrent)
            return -1
          if (b.isCurrent)
            return 1
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })
    }
  } catch (e) {
    console.error(e)
  } finally {
    sessionsLoading.value = false
  }
}

async function revokeSession(token: string) {
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to revoke this session?'))
    return

  try {
    await client.revokeSession({ token })
    toast.add({ title: 'Session revoked', color: 'success' })
    await fetchSessions()
  } catch (e: any) {
    toast.add({ title: 'Error revoking session', description: e.message, color: 'error' })
  }
}

async function revokeAllSessions() {
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to revoke ALL other sessions? This will sign you out of all other devices.'))
    return

  try {
    if (client.revokeOtherSessions) {
      await client.revokeOtherSessions()
    } else {
      // Fallback: revoke one by one (except current)
      const others = sessions.value.filter(s => !s.isCurrent)
      for (const s of others) {
        await client.revokeSession({ token: s.token })
      }
    }
    toast.add({ title: 'All other sessions revoked', color: 'success' })
    await fetchSessions()
  } catch (e: any) {
    toast.add({ title: 'Error revoking sessions', description: e.message, color: 'error' })
  }
}

async function fetchApiKeys() {
  if (!activeOrg.value?.data?.id)
    return
  apiKeysLoading.value = true
  try {
    // Fetch all keys for the organization via custom endpoint
    const data = await $fetch<any[]>('/api/organization/api-keys', {
      query: { organizationId: activeOrg.value.data.id }
    })
    apiKeys.value = data || []
  } catch (e) {
    console.error(e)
    apiKeys.value = []
  } finally {
    apiKeysLoading.value = false
  }
}

async function createApiKey() {
  if (!activeOrg.value?.data?.id || !newKeyName.value)
    return
  createKeyLoading.value = true
  try {
    const { data, error } = await client.apiKey.create({
      name: newKeyName.value,
      expiresIn: newKeyExpiresIn.value,
      metadata: {
        organizationId: activeOrg.value.data.id
      }
    })
    if (error)
      throw error

    if (data) {
      createdKey.value = data.key
      toast.add({ title: 'API Key created', color: 'success' })
      await fetchApiKeys()
    }
  } catch (e: any) {
    toast.add({ title: 'Error creating API Key', description: e.message, color: 'error' })
  } finally {
    createKeyLoading.value = false
  }
}

async function deleteApiKey(id: string) {
  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Are you sure you want to delete this API Key?')
  if (!confirmed)
    return

  try {
    await $fetch(`/api/organization/api-keys/${id}`, {
      method: 'DELETE'
    })
    toast.add({ title: 'API Key deleted', color: 'success' })
    await fetchApiKeys()
  } catch (e: any) {
    toast.add({ title: 'Error deleting API Key', description: e.message, color: 'error' })
  }
}

const copyKey = (key: string) => {
  copy(key)
  toast.add({ title: 'Copied to clipboard' })
}

// Computed permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find(m => m.userId === user.value!.id)
  return member?.role
})

const canUpdateSettings = computed(() => {
  // @ts-expect-error - role type mismatch between client/shared because Drizzle enum vs string
  return canUpdateOrgSettings(currentUserRole.value)
})

// Fetch keys on mount if allowed
onMounted(() => {
  fetchApiKeys()
  fetchSessions()
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
    const { data: orgs } = await organization.list()
    if (orgs && orgs.length > 0) {
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      window.location.href = '/onboarding'
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

const timezones = [
  { label: 'Eastern Time (EST)', value: 'America/New_York' },
  { label: 'Central Time (CST)', value: 'America/Chicago' },
  { label: 'Mountain Time (MST)', value: 'America/Denver' },
  { label: 'Pacific Time (PST)', value: 'America/Los_Angeles' },
  { label: 'Alaska Time (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii Time (HST)', value: 'Pacific/Honolulu' }
]

const teamTimezone = ref(timezones.find(t => t.value === 'America/New_York') || timezones[0])

const { formatDate: formatDateGlobal } = useDate()

function formatDate(date: string | Date) {
  let tz = teamTimezone.value
  // Handle case where timezone is an object (e.g. from SelectMenu without value-attribute working)
  if (typeof tz === 'object' && tz !== null) {
    tz = (tz as any).value
  }
  return formatDateGlobal(date, undefined, tz as string)
}

// Initialize and sync data from activeOrg
const lastSyncedOrgId = ref<string | null>(null)

watch(() => activeOrg.value?.data, (data) => {
  if (!data)
    return

  // Update basic fields only when switching organizations to preserve unsaved edits
  if (data.id !== lastSyncedOrgId.value) {
    teamName.value = data.name
    teamSlug.value = data.slug
    lastSyncedOrgId.value = data.id
  }

  // Always sync timezone from metadata
  const meta = data.metadata
  if (meta) {
    try {
      const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
      if (parsed.timezone) {
        // Handle legacy object format or string format
        const tzValue = (typeof parsed.timezone === 'object' && parsed.timezone !== null)
          ? parsed.timezone.value
          : parsed.timezone.trim()

        const found = timezones.find(t => t.value === tzValue)
        if (found) {
          teamTimezone.value = found
        } else {
          // Fallback if not found in list, construct a temporary object to show value
          teamTimezone.value = { label: tzValue, value: tzValue }
        }
      }
    } catch {
      // Ignore parse error
    }
  }
}, { immediate: true, deep: true })

async function updateTeam() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    // Ensure timezone is a string
    let tz = teamTimezone.value
    if (typeof tz === 'object' && tz !== null) {
      tz = (tz as any).value
    }

    const { error } = await organization.update({
      organizationId: activeOrg.value.data.id,
      data: {
        name: teamName.value,
        slug: teamSlug.value,
        metadata: {
          timezone: tz
        }
      }
    })

    if (error)
      throw error

    toast.add({ title: 'Team updated successfully', color: 'success' })
    // Refresh data
    await useAuth().fetchSession()

    // If slug changed, we must redirect to new URL
    if (teamSlug.value !== activeOrg.value.data.slug) {
      window.location.href = `/${teamSlug.value}/settings`
    }
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
    const { data: orgs } = await organization.list()

    if (orgs && orgs.length > 0) {
      // Switch to first available team
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      // No teams left
      window.location.href = '/onboarding'
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
  <div class="max-w-4xl mx-auto py-8 px-4">
    <h1 class="text-3xl font-semibold mb-8">
      Organization settings
    </h1>

    <div
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900 mb-8"
    >
      <h2 class="text-xl font-semibold mb-4">
        General information
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        For billing purposes you can use the organization ID below.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <UFormField label="Organization name">
          <UInput
            v-model="teamName"
            :disabled="!canUpdateSettings"
          />
        </UFormField>

        <UFormField label="Organization Timezone">
          <USelectMenu
            v-model="teamTimezone"
            :items="timezones"
            option-attribute="label"
            class="w-full"
            :disabled="!canUpdateSettings"
          />
        </UFormField>

        <UFormField label="Organization ID">
          <UInput
            :model-value="activeOrg?.data?.id"
            readonly
            class="font-mono text-sm bg-gray-50 dark:bg-gray-800"
          >
            <template #trailing>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                color="gray"
                variant="ghost"
                size="xs"
                @click="copyId"
              />
            </template>
          </UInput>
        </UFormField>
      </div>

      <UButton
        v-if="canUpdateSettings"
        label="Save"
        color="black"
        :loading="loading"
        @click="updateTeam"
      />
    </div>

    <!-- API Keys Section -->
    <div
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900 mb-8"
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">
          API Keys
        </h2>
        <div
          v-if="canUpdateSettings"
          class="flex items-center gap-2"
        >
          <span
            v-if="apiKeys.length >= 4"
            class="text-xs text-red-500"
          >
            Max 4 keys reached
          </span>
          <UButton
            label="Create New Key"
            icon="i-lucide-plus"
            size="sm"
            :disabled="apiKeys.length >= 4"
            @click="isCreateKeyModalOpen = true"
          />
        </div>
      </div>
      <p class="text-sm text-gray-500 mb-6">
        Manage API keys for accessing the organization programmatically.
      </p>

      <div
        v-if="apiKeysLoading"
        class="space-y-3"
      >
        <div
          v-for="i in 3"
          :key="i"
          class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
        >
          <div class="space-y-2">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-3 w-48" />
            <USkeleton class="h-3 w-24" />
          </div>
          <USkeleton class="h-8 w-8 rounded-md" />
        </div>
      </div>
      <div
        v-else-if="!apiKeys || apiKeys.length === 0"
        class="text-sm text-gray-500"
      >
        No API keys found.
      </div>
      <div
        v-else
        class="space-y-4"
      >
        <div
          v-for="key in apiKeys"
          :key="key.id"
          class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
        >
          <div>
            <div class="font-medium">
              {{ key.name }}
            </div>
            <div class="text-xs text-gray-500 font-mono">
              {{ key.start }}... <span v-if="key.prefix">({{ key.prefix }})</span>
            </div>
            <div class="text-xs text-gray-400 mt-1">
              Created: {{ formatDate(key.createdAt) }}
              <span> • Last used: {{ key.lastRequest ? formatDate(key.lastRequest) : 'Never' }}</span>
              <span v-if="key.expiresAt"> • Expires: {{ formatDate(key.expiresAt) }}</span>
            </div>
          </div>
          <UButton
            v-if="canUpdateSettings"
            color="red"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="deleteApiKey(key.id)"
          />
        </div>
      </div>
    </div>

    <!-- Trusted Devices -->
    <div class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900 mb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">
          Trusted Devices
        </h2>
        <UButton
          v-if="sessions.length > 1"
          label="Revoke all sessions except current"
          color="red"
          variant="ghost"
          size="sm"
          @click="revokeAllSessions"
        />
      </div>
      <p class="text-sm text-gray-500 mb-6">
        Manage your active sessions and devices.
      </p>

      <div
        v-if="sessionsLoading"
        class="space-y-3"
      >
        <div
          v-for="i in 3"
          :key="i"
          class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <USkeleton class="h-5 w-5 rounded-full" />
            <div class="space-y-1">
              <USkeleton class="h-4 w-48" />
              <USkeleton class="h-3 w-32" />
            </div>
          </div>
          <USkeleton class="h-6 w-16 rounded-md" />
        </div>
      </div>
      <div
        v-else
        class="space-y-4"
      >
        <div
          v-for="s in displayedSessions"
          :key="s.id"
          class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <UIcon
              :name="s.icon"
              class="w-5 h-5 text-gray-500"
            />
            <div>
              <div class="font-medium flex items-center gap-2">
                {{ s.browser }} on {{ s.os }}
                <UBadge
                  v-if="s.isCurrent"
                  label="Current"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <div class="text-xs text-gray-500 mt-1">
                {{ s.ipAddress }} • Last active: {{ formatDate(s.updatedAt) }}
              </div>
            </div>
          </div>
          <UButton
            v-if="!s.isCurrent"
            color="red"
            variant="ghost"
            label="Revoke"
            size="xs"
            @click="revokeSession(s.token)"
          />
        </div>
        <div
          v-if="sessions.length > 4"
          class="text-center pt-2"
        >
          <UButton
            variant="link"
            color="gray"
            :label="showAllSessions ? 'Show less' : `Show ${sessions.length - 4} more`"
            @click="showAllSessions = !showAllSessions"
          />
        </div>
      </div>
    </div>

    <UModal
      v-model:open="isCreateKeyModalOpen"
      title="Create API Key"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="createdKey"
            class="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800"
          >
            <p class="text-sm text-green-800 dark:text-green-200 font-medium mb-2">
              API Key Created! Copy it now, you won't see it again.
            </p>
            <div class="flex gap-2">
              <UInput
                :model-value="createdKey"
                readonly
                class="flex-1 font-mono"
              />
              <UButton
                icon="i-lucide-copy"
                color="gray"
                @click="copyKey(createdKey)"
              />
            </div>
            <UButton
              class="mt-4"
              block
              @click="isCreateKeyModalOpen = false; createdKey = null; newKeyName = ''"
            >
              Done
            </UButton>
          </div>
          <div
            v-else
            class="space-y-4"
          >
            <UFormField label="Key Name">
              <UInput
                v-model="newKeyName"
                placeholder="e.g. CI/CD Pipeline"
              />
            </UFormField>
            <UFormField label="Expiration (Seconds)">
              <UInput
                v-model="newKeyExpiresIn"
                type="number"
                placeholder="Leave empty for never"
              />
              <p class="text-xs text-gray-500 mt-1">
                Default is never if empty.
              </p>
            </UFormField>
            <div class="flex justify-end gap-2 pt-4">
              <UButton
                label="Cancel"
                color="gray"
                variant="ghost"
                @click="isCreateKeyModalOpen = false"
              />
              <UButton
                label="Create"
                :loading="createKeyLoading"
                @click="createApiKey"
              />
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <div
      v-if="canLeaveTeam"
      class="border border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-900/10 mb-8"
    >
      <h2 class="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
        Leave organization
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        Revoke your access to this organization. You will need to be re-invited to join again.
      </p>

      <UButton
        color="red"
        variant="outline"
        icon="i-lucide-log-out"
        :loading="leaveLoading"
        class="cursor-pointer"
        @click="leaveTeam"
      >
        Leave Team
      </UButton>
    </div>

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
        color="red"
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
