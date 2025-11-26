<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
})

const currentRoute = useRoute()
const router = useRouter()
const slug = computed(() => currentRoute.params.slug as string)
const toast = useToast()

const { user, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const youtubeScopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl'
]

const organizationId = computed(() => activeOrg.value?.data?.id ?? null)
interface OrgMember {
  userId?: string | null
  name?: string | null
  email?: string | null
  role?: string | null
}

const members = computed<OrgMember[]>(() => activeOrg.value?.data?.members ?? [])

const currentUserRole = computed(() => {
  if (!members.value.length || !user.value?.id)
    return null

  return members.value.find(member => member.userId === user.value!.id)?.role ?? null
})

const canManageIntegrations = computed(() => {
  return currentUserRole.value === 'owner' || currentUserRole.value === 'admin'
})

const {
  data: integrations,
  pending,
  error,
  refresh
} = await useFetch(() => '/api/organization/integrations', {
  key: () => `org-integrations-${organizationId.value || 'none'}`,
  watch: [organizationId]
})

const youtubeIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'youtube') || null
})

const integrationStatus = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const connectedByUser = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const connectLoading = ref(false)
const disconnectLoading = ref(false)

function assertOrgId() {
  if (!organizationId.value) {
    throw new Error('Active organization not found.')
  }
}

async function connectYoutube() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.value = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/settings/integrations?connected=youtube`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'google',
        scopes: youtubeScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start YouTube connection',
        description: 'Please try again in a few moments.',
        color: 'error'
      })
      return
    }

    const redirectUrl = new URL(response.url)
    redirectUrl.searchParams.set('prompt', 'consent')
    redirectUrl.searchParams.set('access_type', 'offline')
    redirectUrl.searchParams.set('include_granted_scopes', 'true')

    window.location.href = redirectUrl.toString()
  } catch (error: any) {
    toast.add({
      title: 'Error connecting YouTube',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.value = false
  }
}

async function disconnectYoutube() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will revoke caption access until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.value = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'youtube'
      }
    })
    toast.add({ title: 'YouTube disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting YouTube',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.value = false
  }
}

watchEffect(() => {
  if (!import.meta.client)
    return
  if (currentRoute.query.connected === 'youtube') {
    toast.add({ title: 'YouTube connected', description: 'Captions can now be ingested automatically.', color: 'success' })
    const newQuery = { ...currentRoute.query }
    delete newQuery.connected
    router.replace({ path: currentRoute.path, query: newQuery })
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 py-8">
    <UContainer class="space-y-6">
      <div class="space-y-1">
        <h1 class="text-3xl font-semibold">
          Integrations
        </h1>
        <p class="text-muted-500">
          Connect Codex to YouTube so captions can be ingested automatically for your organization.
        </p>
      </div>

      <UAlert
        v-if="!canManageIntegrations"
        icon="i-lucide-lock"
        color="neutral"
        variant="subtle"
        title="You need admin or owner access to manage integrations."
      />

      <div class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-simple-icons-youtube"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  YouTube
                </p>
                <p class="text-sm text-muted-500">
                  Required for pulling captions from shared videos.
                </p>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-500">
                Status
              </span>
              <UBadge
                :color="integrationStatus === 'connected' ? 'primary' : integrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ integrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="youtubeIntegration && connectedByUser">
                Connected by <strong>{{ connectedByUser.name || connectedByUser.email }}</strong>
              </p>
              <p v-else-if="youtubeIntegration">
                Connected by <strong>Unknown user</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ youtubeIntegration?.updatedAt ? new Date(youtubeIntegration.updatedAt).toLocaleString() : '—' }}
                </strong>
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading"
                @click="connectYoutube"
              >
                {{ youtubeIntegration ? 'Reconnect' : 'Connect YouTube' }}
              </UButton>

              <UButton
                v-if="youtubeIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading"
                @click="disconnectYoutube"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <p class="text-lg font-medium">
              How it works
            </p>
          </template>

          <ol class="space-y-3 text-sm text-muted-500">
            <li>
              1. Click <strong>Connect YouTube</strong> and sign in with the Google account that manages your channel captions.
            </li>
            <li>
              2. Approve the requested scopes so Codex can read caption tracks (read-only, no publishing).
            </li>
            <li>
              3. Once connected, any team member can paste a YouTube link in chat and Codex will automatically ingest the transcript.
            </li>
            <li>
              4. If the token expires, reconnect to refresh the Google consent.
            </li>
          </ol>
        </UCard>
      </div>

      <UAlert
        v-if="error"
        icon="i-lucide-alert-triangle"
        color="error"
        variant="subtle"
        :description="error?.message || 'Unable to load current integrations.'"
      />

      <div
        v-else-if="pending"
        class="space-y-2"
      >
        <div class="h-16 rounded-lg bg-muted animate-pulse" />
        <div class="h-16 rounded-lg bg-muted animate-pulse" />
      </div>
    </UContainer>
  </div>
</template>
