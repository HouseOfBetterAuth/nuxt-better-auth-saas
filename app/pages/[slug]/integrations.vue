<script setup lang="ts">
import { GITHUB_INTEGRATION_SCOPES } from '#shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_SCOPES } from '#shared/constants/googleScopes'

const { formatDateRelative } = useDate()

definePageMeta({
  layout: 'settings'
})

useHead({
  title: 'Integrations'
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Integrations')

const currentRoute = useRoute()
const router = useRouter()
const slug = computed(() => currentRoute.params.slug as string)
const toast = useToast()

const { user, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const youtubeScopes = [...GOOGLE_INTEGRATION_SCOPES.youtube]
const googleDriveScopes = [...GOOGLE_INTEGRATION_SCOPES.google_drive]
const githubScopes = [...GITHUB_INTEGRATION_SCOPES.github]

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

const googleDriveIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'google_drive') || null
})

const githubIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'github') || null
})

const youtubeIntegrationStatus = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const googleDriveIntegrationStatus = computed(() => {
  const integration = googleDriveIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const githubIntegrationStatus = computed(() => {
  const integration = githubIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const youtubeConnectedByUser = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const googleDriveConnectedByUser = computed(() => {
  const integration = googleDriveIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const githubConnectedByUser = computed(() => {
  const integration = githubIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const connectLoading = reactive({
  youtube: false,
  google_drive: false,
  github: false
})
const disconnectLoading = reactive({
  youtube: false,
  google_drive: false,
  github: false
})

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

  connectLoading.youtube = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=youtube`
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
    connectLoading.youtube = false
  }
}

async function connectGoogleDrive() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.google_drive = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=google_drive`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'google',
        scopes: googleDriveScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start Google Drive connection',
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
      title: 'Error connecting Google Drive',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.google_drive = false
  }
}

async function connectGithub() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.github = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=github`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'github',
        scopes: githubScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start GitHub connection',
        description: 'Please try again in a few moments.',
        color: 'error'
      })
      return
    }

    window.location.href = response.url
  } catch (error: any) {
    toast.add({
      title: 'Error connecting GitHub',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.github = false
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

  disconnectLoading.youtube = true
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
    disconnectLoading.youtube = false
  }
}

async function disconnectGoogleDrive() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will remove Codex access to Drive and Docs until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.google_drive = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'google_drive'
      }
    })
    toast.add({ title: 'Google Drive disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting Google Drive',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.google_drive = false
  }
}

async function disconnectGithub() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will remove Codex access to GitHub repositories until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.github = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'github'
      }
    })
    toast.add({ title: 'GitHub disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting GitHub',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.github = false
  }
}

if (import.meta.client) {
  const stripConnectedQuery = () => {
    const newQuery = { ...currentRoute.query }
    delete newQuery.connected
    router.replace({ path: currentRoute.path, query: newQuery }).catch((error) => {
      // Avoid blowing up the page if a navigation race occurs; log for debugging instead.
      console.warn('[integrations] Unable to strip ?connected query param', error)
    })
  }

  onMounted(() => {
    watch(
      () => currentRoute.query.connected,
      (value) => {
        const possibleValues = Array.isArray(value) ? value : value ? [value] : []
        const provider = possibleValues.find(item => item === 'youtube' || item === 'google_drive' || item === 'github')
        if (!provider)
          return

        const messages = {
          youtube: {
            title: 'YouTube connected',
            description: 'You can now get transcripts from your own YouTube videos automatically.'
          },
          google_drive: {
            title: 'Google Drive connected',
            description: 'Docs can now be imported without copying content manually.'
          },
          github: {
            title: 'GitHub connected',
            description: 'Repositories can now be synced without manual exports.'
          }
        } as const

        const message = messages[provider as keyof typeof messages]
        toast.add({
          title: message.title,
          description: message.description,
          color: 'success'
        })
        stripConnectedQuery()
      },
      { immediate: true }
    )
  })
}
</script>

<template>
  <UContainer class="py-10">
    <div class="space-y-8">
      <div class="space-y-1">
        <h1 class="text-3xl font-semibold">
          Integrations
        </h1>
        <p class="text-muted-500">
          Connect Codex to YouTube, Google Drive, and GitHub. Get transcripts from your own YouTube videos, import Google Docs, and sync GitHub repositories automatically.
        </p>
      </div>

      <UAlert
        v-if="!canManageIntegrations"
        icon="i-lucide-lock"
        color="neutral"
        variant="subtle"
        title="You need admin or owner access to manage integrations."
      />

      <div class="grid gap-4">
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
                  Get transcripts from your own YouTube videos automatically.
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
                :color="youtubeIntegrationStatus === 'connected' ? 'primary' : youtubeIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ youtubeIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="youtubeIntegration && youtubeConnectedByUser">
                Connected by <strong>{{ youtubeConnectedByUser.name || youtubeConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="youtubeIntegration">
                Connected by <strong>Unknown user</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(youtubeIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <UAlert
              icon="i-lucide-info"
              color="neutral"
              variant="subtle"
              title="Note"
              description="You can only get transcripts from videos you own. Videos from other channels are not accessible."
            />

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.youtube"
                @click="connectYoutube"
              >
                {{ youtubeIntegration ? 'Reconnect' : 'Connect YouTube' }}
              </UButton>

              <UButton
                v-if="youtubeIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.youtube"
                @click="disconnectYoutube"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-lucide-github"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  GitHub Repos
                </p>
                <p class="text-sm text-muted-500">
                  Required for syncing private repositories into Codex.
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
                :color="githubIntegrationStatus === 'connected' ? 'primary' : githubIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ githubIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="githubIntegration && githubConnectedByUser">
                Connected by <strong>{{ githubConnectedByUser.name || githubConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="githubIntegration">
                Connected by <strong>Unknown user</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(githubIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.github"
                @click="connectGithub"
              >
                {{ githubIntegration ? 'Reconnect' : 'Connect GitHub' }}
              </UButton>

              <UButton
                v-if="githubIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.github"
                @click="disconnectGithub"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-simple-icons-googledrive"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  Google Drive & Docs
                </p>
                <p class="text-sm text-muted-500">
                  Required for importing shared Google Docs without copy/paste.
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
                :color="googleDriveIntegrationStatus === 'connected' ? 'primary' : googleDriveIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ googleDriveIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="googleDriveIntegration && googleDriveConnectedByUser">
                Connected by <strong>{{ googleDriveConnectedByUser.name || googleDriveConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="googleDriveIntegration">
                Connected by <strong>Unknown user</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(googleDriveIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.google_drive"
                @click="connectGoogleDrive"
              >
                {{ googleDriveIntegration ? 'Reconnect' : 'Connect Google Drive' }}
              </UButton>

              <UButton
                v-if="googleDriveIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.google_drive"
                @click="disconnectGoogleDrive"
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
              1. Click <strong>Connect</strong> on the integration you need and sign in with the account that has access.
            </li>
            <li>
              2. Approve the requested scopes so Codex can read captions, Google Docs, or GitHub repositories (read-only unless stated otherwise).
            </li>
            <li>
              3. Once connected, teammates can share YouTube links, Google Docs, or GitHub repos and Codex will ingest them automatically.
            </li>
            <li>
              4. If a token expires, reconnect to refresh the consent with the provider.
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
        class="space-y-3"
      >
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-16 rounded-lg border border-muted-200/70"
        />
      </div>
    </div>
  </UContainer>
</template>
