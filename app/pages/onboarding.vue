<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'

definePageMeta({
  layout: 'simple' as any
})

const { user, organization, fetchSession } = useAuth()
const toast = useToast()

const { data: invitations } = await useAsyncData('user-invitations', async () => {
  return await $fetch('/api/auth/user/invitations', {
    headers: useRequestHeaders(['cookie'])
  })
})

const newTeamName = ref('')
const newTeamSlug = ref('')
const isSlugManuallyEdited = ref(false)
const creating = ref(false)
const slugError = ref('')
const isCheckingSlug = ref(false)

const checkSlug = useDebounceFn(async (slug: string) => {
  if (!slug || slug.length < 3) {
    return
  }
  isCheckingSlug.value = true
  try {
    const { available } = await $fetch('/api/organization/check-slug', {
      query: { slug },
      headers: useRequestHeaders(['cookie'])
    })
    if (!available) {
      slugError.value = 'Slug is already taken'
    } else {
      slugError.value = ''
    }
  } catch (e) {
    console.error(e)
  } finally {
    isCheckingSlug.value = false
  }
}, 500)

watch(newTeamName, (newName) => {
  if (!isSlugManuallyEdited.value) {
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    newTeamSlug.value = slug
    checkSlug(slug)
  }
})

watch(newTeamSlug, (newSlug) => {
  slugError.value = ''
  if (isSlugManuallyEdited.value) {
    checkSlug(newSlug)
  }
})

async function createTeam() {
  if (!newTeamName.value.trim() || !newTeamSlug.value.trim() || slugError.value)
    return
  creating.value = true

  try {
    const { data, error } = await organization.create({
      name: newTeamName.value,
      slug: newTeamSlug.value
    })

    if (error)
      throw error

    if (data) {
      await organization.setActive({ organizationId: data.id })
      await fetchSession()
      toast.add({ title: 'Team created successfully', color: 'success' })
      window.location.href = `/${data.slug}/dashboard`
    }
  } catch (e: any) {
    toast.add({
      title: 'Error creating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

async function acceptInvite(inviteId: string, orgId?: string) {
  try {
    const { error } = await organization.acceptInvitation({
      invitationId: inviteId
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation accepted', color: 'success' })

    // If orgId is provided, set it active immediately
    if (orgId) {
      await organization.setActive({ organizationId: orgId })
    }

    // Refresh session to update active org
    await fetchSession()
    // Get active org to find slug
    const { data: activeOrg } = await organization.list()
    if (activeOrg && activeOrg.length > 0) {
      // Since we set it active, it should be the first one or we can find it
      const targetOrg = activeOrg.find(o => o.id === orgId) || activeOrg[0]
      if (targetOrg) {
        window.location.href = `/${targetOrg.slug}/dashboard`
      } else {
        window.location.href = '/t/dashboard'
      }
    } else {
      // Fallback: Go to generic dashboard and let layout handle activation
      window.location.href = '/t/dashboard'
    }
  } catch (e: any) {
    toast.add({
      title: 'Error accepting invitation',
      description: e.message,
      color: 'error'
    })
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
    <UCard class="max-w-md w-full">
      <div class="text-center mb-8">
        <div class="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
          <UIcon
            name="i-lucide-users"
            class="w-6 h-6 text-primary"
          />
        </div>
        <h1 class="text-2xl font-bold mb-2">
          Welcome, {{ user?.name }}!
        </h1>
        <p class="text-muted-foreground">
          To get started, create a new team or join one you've been invited to.
        </p>
      </div>

      <div class="space-y-6">
        <!-- Create Team Section -->
        <div>
          <h2 class="font-semibold mb-4 flex items-center gap-2">
            <UIcon
              name="i-lucide-plus-circle"
              class="w-4 h-4"
            />
            Create a new team
          </h2>
          <div class="flex flex-col gap-2">
            <UInput
              v-model="newTeamName"
              placeholder="Team Name (e.g. Acme Inc)"
              @keyup.enter="createTeam"
            />
            <UInput
              v-model="newTeamSlug"
              placeholder="acme-inc"
              icon="i-lucide-link"
              :loading="isCheckingSlug"
              :error="!!slugError"
              @input="isSlugManuallyEdited = true"
              @keyup.enter="createTeam"
            />
            <p
              v-if="slugError"
              class="text-xs text-red-500"
            >
              {{ slugError }}
            </p>
            <UButton
              :loading="creating"
              :disabled="!newTeamName.trim() || !newTeamSlug.trim()"
              block
              @click="createTeam"
            >
              Create Team
            </UButton>
          </div>
        </div>

        <USeparator
          v-if="invitations && invitations.length > 0"
          label="OR"
        />

        <!-- Invitations Section -->
        <div v-if="invitations && invitations.length > 0">
          <h2 class="font-semibold mb-4 flex items-center gap-2">
            <UIcon
              name="i-lucide-mail"
              class="w-4 h-4"
            />
            Accept an invitation
          </h2>
          <div class="space-y-3">
            <div
              v-for="invite in invitations"
              :key="invite.id"
              class="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900"
            >
              <div class="text-sm">
                <div class="font-medium">
                  {{ invite.organizationName }}
                </div>
                <div class="text-xs text-muted-foreground">
                  Invited as {{ invite.role }}
                </div>
              </div>
              <UButton
                size="xs"
                variant="solid"
                color="primary"
                @click="acceptInvite(invite.id, invite.organizationId)"
              >
                Join
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
