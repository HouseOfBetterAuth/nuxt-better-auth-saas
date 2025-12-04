<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'

const { user, organization, fetchSession } = useAuth()
const toast = useToast()
const router = useRouter()
const { isOnboardingOpen, hideOnboarding, refreshOrganizations } = useOnboarding()

const { data: invitations, pending: invitationsPending, refresh: refreshInvitations } = useAsyncData('user-invitations', async () => {
  return await $fetch('/api/auth/user/invitations', {
    headers: useRequestHeaders(['cookie'])
  })
}, {
  immediate: false,
  server: false,
  lazy: true
})

const newTeamName = ref('')
const newTeamSlug = ref('')
const isSlugManuallyEdited = ref(false)
const creating = ref(false)
const acceptingInviteId = ref<string | null>(null)
const slugError = ref('')
const isCheckingSlug = ref(false)

const hasInvitations = computed(() => Array.isArray(invitations.value) && invitations.value.length > 0)

const checkSlug = useDebounceFn(async (slug: string) => {
  if (!slug || slug.length < 3) {
    slugError.value = ''
    return
  }
  isCheckingSlug.value = true
  try {
    const { available } = await $fetch('/api/organization/check-slug', {
      query: { slug },
      headers: useRequestHeaders(['cookie'])
    })
    slugError.value = available ? '' : 'Slug is already taken'
  } catch (e) {
    console.error('[OnboardingModal] Failed to check slug', e)
  } finally {
    isCheckingSlug.value = false
  }
}, 400)

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

const resetModalState = () => {
  newTeamName.value = ''
  newTeamSlug.value = ''
  isSlugManuallyEdited.value = false
  slugError.value = ''
}

watch(isOnboardingOpen, (open) => {
  if (open) {
    resetModalState()
    refreshInvitations()
  }
})

async function createTeam() {
  if (!newTeamName.value.trim() || !newTeamSlug.value.trim() || slugError.value || isCheckingSlug.value)
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
      await refreshOrganizations()
      toast.add({ title: 'Team created successfully', color: 'success' })
      hideOnboarding()
      await router.push(`/${data.slug}/dashboard`)
    }
  } catch (e: any) {
    toast.add({
      title: 'Error creating team',
      description: e?.message || 'Please try again.',
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

async function acceptInvite(inviteId: string, orgId?: string) {
  acceptingInviteId.value = inviteId
  try {
    const { error } = await organization.acceptInvitation({
      invitationId: inviteId
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation accepted', color: 'success' })

    if (orgId) {
      await organization.setActive({ organizationId: orgId })
    }

    await fetchSession()
    await refreshOrganizations()

    if (!orgId) {
      hideOnboarding()
      await router.push('/')
      return
    }

    let joinedOrg = null
    let attempts = 0
    const maxAttempts = 3
    while (attempts < maxAttempts && !joinedOrg) {
      const { data: orgs } = await organization.list()
      joinedOrg = orgs?.find((o: any) => o.id === orgId)
      attempts++
      if (!joinedOrg && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 400))
      }
    }

    if (joinedOrg) {
      hideOnboarding()
      await router.push(`/${joinedOrg.slug}/dashboard`)
    } else {
      hideOnboarding()
      await router.push('/')
    }
  } catch (e: any) {
    toast.add({
      title: 'Error accepting invitation',
      description: e?.message || 'Please try again.',
      color: 'error'
    })
  } finally {
    acceptingInviteId.value = null
  }
}
</script>

<template>
  <UModal
    v-model:open="isOnboardingOpen"
    title="Welcome! Let's get you set up"
    description="Create a new team or join one that you've been invited to."
    size="lg"
  >
    <template #body>
      <div class="space-y-8">
        <div>
          <div class="text-center mb-6">
            <div class="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
              <UIcon
                name="i-lucide-users"
                class="w-6 h-6 text-primary"
              />
            </div>
            <h2 class="text-xl font-semibold">
              Welcome, {{ user?.name || 'there' }}!
            </h2>
            <p class="text-muted-foreground text-sm">
              Teams power your workspace. Create one or join an existing invite to start collaborating.
            </p>
          </div>

          <div class="space-y-4">
            <h3 class="font-semibold flex items-center gap-2">
              <UIcon
                name="i-lucide-plus-circle"
                class="w-4 h-4"
              />
              Create a new team
            </h3>
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
                block
                :loading="creating"
                :disabled="!newTeamName.trim() || !newTeamSlug.trim() || !!slugError || isCheckingSlug"
                @click="createTeam"
              >
                Create Team
              </UButton>
            </div>
          </div>
        </div>

        <USeparator
          v-if="hasInvitations"
          label="or"
        />

        <div v-if="hasInvitations">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <UIcon
              name="i-lucide-mail"
              class="w-4 h-4"
            />
            Accept an invitation
          </h3>
          <div class="space-y-3">
            <UAlert
              v-if="invitationsPending"
              title="Loading invitations..."
              icon="i-lucide-loader-2"
              color="neutral"
            />
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
                :loading="acceptingInviteId === invite.id"
                :disabled="!!acceptingInviteId && acceptingInviteId !== invite.id"
                @click="acceptInvite(invite.id, invite.organizationId)"
              >
                Join
              </UButton>
            </div>
          </div>
        </div>

        <UAlert
          v-else-if="!invitationsPending"
          icon="i-lucide-info"
          title="No invitations found"
          :description="`If you're expecting an invite, double-check that it was sent to ${user?.email}.`"
        />
        <UAlert
          v-else
          icon="i-lucide-loader-2"
          title="Loading invitations..."
        />
      </div>
    </template>

    <template #footer>
      <UButton
        variant="ghost"
        color="neutral"
        @click="hideOnboarding"
      >
        Close
      </UButton>
    </template>
  </UModal>
</template>
