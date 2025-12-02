<script setup lang="ts">
/**
 * Trusted Devices / Sessions management section
 * Allows users to view and revoke active sessions
 *
 * Usage: <SettingsSessionsSection />
 */
const { client } = useAuth()
const toast = useToast()

const sessions = ref<any[]>([])
const loading = ref(false)
const showAll = ref(false)

const { formatDate } = useDate()

const displayedSessions = computed(() => {
  if (showAll.value)
    return sessions.value
  return sessions.value.slice(0, 4)
})

function parseUserAgent(ua: string) {
  if (!ua)
    return { browser: 'Unknown', os: 'Unknown', icon: 'i-lucide-help-circle' }

  let browser = 'Unknown Browser'
  let os = 'Unknown OS'
  let icon = 'i-lucide-monitor'

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
  } else if (ua.includes('Mac')) {
    os = 'macOS'
  } else if (ua.includes('Linux')) {
    os = 'Linux'
  } else if (ua.includes('Android')) {
    os = 'Android'
    icon = 'i-lucide-smartphone'
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS'
    icon = 'i-lucide-smartphone'
  }

  return { browser, os, icon }
}

async function fetchSessions() {
  loading.value = true
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
    loading.value = false
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

onMounted(() => {
  fetchSessions()
})
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900">
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

    <!-- Loading State -->
    <div
      v-if="loading"
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

    <!-- Sessions List -->
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

      <!-- Show More -->
      <div
        v-if="sessions.length > 4"
        class="text-center pt-2"
      >
        <UButton
          variant="link"
          color="gray"
          :label="showAll ? 'Show less' : `Show ${sessions.length - 4} more`"
          @click="showAll = !showAll"
        />
      </div>
    </div>
  </div>
</template>
