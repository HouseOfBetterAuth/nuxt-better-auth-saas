<script setup lang="ts">
const route = useRoute()
const localePath = useLocalePath()
const { organization, loggedIn, fetchSession, session } = useAuth()
const toast = useToast()
const loading = ref(true)
const error = ref('')

const invitationId = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id || ''

onMounted(async () => {
  // Ensure session is up to date before checking login status
  if (!session.value) {
    await fetchSession()
  }

  if (!loggedIn.value) {
    if (import.meta.client && invitationId) {
      localStorage.setItem('pending_invite', invitationId)
    }
    return navigateTo(localePath(`/signup?redirect=${route.fullPath}`))
  }

  if (!invitationId) {
    error.value = 'Invalid invitation link'
    loading.value = false
    return
  }

  try {
    const { data: result, error: apiError } = await organization.acceptInvitation({
      invitationId
    })
    if (apiError)
      throw apiError

    // Fetch the organization details to get the slug
    await fetchSession()

    // Retry fetching orgs a few times if the new org isn't immediately visible
    let joinedOrg = null
    let attempts = 0
    let orgFetchFailed = false
    while (attempts < 3 && !joinedOrg) {
      try {
        const { data: orgs } = await organization.list()
        orgFetchFailed = false
        joinedOrg = orgs?.find((o: any) => o.id === result?.invitation?.organizationId)
      } catch (fetchError) {
        console.error('[Accept Invite] Failed to fetch organizations', fetchError)
        orgFetchFailed = true
      }

      if (!joinedOrg) {
        attempts++
        if (attempts < 3) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    }

    if (joinedOrg) {
      toast.add({ title: 'Invitation accepted', color: 'success' })
      // Redirect to the specific organization's dashboard
      window.location.href = `/${joinedOrg.slug}/dashboard`
    } else {
      if (orgFetchFailed) {
        toast.add({
          title: 'Invitation accepted',
          description: 'Failed to load organization details. Redirecting you to the dashboard.',
          color: 'warning'
        })
      }
      // Fallback: Redirect to root, middleware will route to active org
      window.location.href = '/'
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to accept invitation'
  } finally {
    loading.value = false
  }
})

definePageMeta({
  layout: false,
  auth: false
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
    <UCard class="w-full max-w-md">
      <div class="text-center">
        <h1 class="text-xl font-semibold mb-4">
          Accepting Invitation
        </h1>

        <div
          v-if="loading"
          class="flex justify-center my-8"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="h-8 w-8 animate-spin text-primary"
          />
        </div>

        <div
          v-else-if="error"
          class="text-red-500 mb-4"
        >
          <UIcon
            name="i-lucide-alert-circle"
            class="h-12 w-12 mx-auto mb-2"
          />
          <p>{{ error }}</p>
          <UButton
            to="/"
            class="mt-4"
            variant="outline"
          >
            Go Home
          </UButton>
        </div>

        <div v-else>
          <UIcon
            name="i-lucide-check-circle"
            class="h-12 w-12 mx-auto mb-2 text-amber-500"
          />
          <p>Redirecting to dashboard...</p>
        </div>
      </div>
    </UCard>
  </div>
</template>
