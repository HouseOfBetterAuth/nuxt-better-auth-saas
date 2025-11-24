<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

definePageMeta({
  layout: 'dashboard'
})

const { organization, useActiveOrganization, session, user, fetchSession } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

const inviteEmail = ref('')
const inviteRole = ref('member')
const loading = ref(false)

// SSR: Prefetch session and organization data
const { data: preloadedOrg } = await useAsyncData('members-page-data', async () => {
  const [, orgRes] = await Promise.all([
    $fetch('/api/auth/get-session', { headers: useRequestHeaders(['cookie']) }),
    $fetch('/api/auth/organization/get-full-organization', { headers: useRequestHeaders(['cookie']) })
  ])
  return orgRes
}, {
  server: true,
  lazy: false
})

// Initialize activeOrg with preloaded data if available
if (preloadedOrg.value && activeOrg.value) {
  activeOrg.value.data = preloadedOrg.value as any
}

// Watch for preloaded data changes (hydration)
watch(preloadedOrg, (newData) => {
  if (newData && activeOrg.value) {
    activeOrg.value.data = newData as any
  }
}, { immediate: true })

// Check if current user is admin or owner
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find(m => m.userId === user.value.id)
  return member?.role || null
})

const canManageMembers = computed(() => {
  return currentUserRole.value === 'admin' || currentUserRole.value === 'owner'
})

// Check if we need to set an active org on mount
onMounted(async () => {
  // Only set first org if there's truly no active org in the session
  if (!session.value?.activeOrganizationId) {
    const { data } = await organization.list()
    if (data && data.length > 0) {
      await organization.setActive({ organizationId: data[0].id })
      await useAuth().fetchSession()
    } else {
      // Redirect to onboarding if no teams exist
      navigateTo('/onboarding')
    }
  }
})

const roles = [
  { label: 'Member', value: 'member' },
  { label: 'Admin', value: 'admin' },
  { label: 'Owner', value: 'owner' }
]

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getInviteLink(invitationId: string) {
  return import.meta.client
    ? `${window.location.origin}/accept-invite/${invitationId}`
    : ''
}

async function copyLink(invitationId: string) {
  const link = getInviteLink(invitationId)
  if (link) {
    await copy(link)
    toast.add({ title: 'Link copied to clipboard', color: 'success' })
  }
}

// ─────────────────────────────────────────────
// Member Management
// ─────────────────────────────────────────────
async function updateMemberRole(memberId: string, newRole: string) {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    const { error } = await organization.updateMemberRole({
      organizationId: activeOrg.value.data.id,
      memberId,
      role: newRole as 'admin' | 'member' | 'owner'
    })

    if (error)
      throw error

    toast.add({ title: 'Role updated successfully', color: 'success' })
    await fetchSession()
    const orgData = await $fetch('/api/auth/organization/get-full-organization')
    if (orgData && activeOrg.value) {
      activeOrg.value.data = orgData as any
    }
  } catch (e: any) {
    toast.add({
      title: 'Error updating role',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function removeMember(memberId: string) {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true

  try {
    const { error } = await organization.removeMember({
      organizationId: activeOrg.value.data.id,
      memberIdOrEmail: memberId
    })

    if (error)
      throw error

    toast.add({ title: 'Member removed successfully', color: 'success' })
    await fetchSession()
    const orgData = await $fetch('/api/auth/organization/get-full-organization')
    if (orgData && activeOrg.value) {
      activeOrg.value.data = orgData as any
    }
  } catch (e: any) {
    toast.add({
      title: 'Error removing member',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// ─────────────────────────────────────────────
// Invite Member
// ─────────────────────────────────────────────
async function inviteMember() {
  if (!inviteEmail.value || !activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    const { error } = await organization.inviteMember({
      email: inviteEmail.value,
      role: inviteRole.value,
      organizationId: activeOrg.value.data.id
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation sent', color: 'success' })
    inviteEmail.value = ''
    await fetchSession()
    const orgData = await $fetch('/api/auth/organization/get-full-organization')
    if (orgData && activeOrg.value) {
      activeOrg.value.data = orgData as any
    }
  } catch (e: any) {
    toast.add({
      title: 'Error inviting member',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function revokeInvitation(invitationId: string) {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const { error } = await organization.cancelInvitation({
      invitationId
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation revoked', color: 'success' })
    await fetchSession()
    const orgData = await $fetch('/api/auth/organization/get-full-organization')
    if (orgData && activeOrg.value) {
      activeOrg.value.data = orgData as any
    }
  } catch (e: any) {
    toast.add({
      title: 'Error revoking invitation',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Members UI -->
    <div
      v-if="activeOrg.data"
      class="flex flex-col gap-6"
    >
      <UCard>
        <template #header>
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">
              {{ activeOrg.data.name }} Members
            </h3>
            <UBadge color="gray">
              {{ activeOrg.data.members.length }} members
            </UBadge>
          </div>
        </template>

        <!-- Invite Form (Only for admins and owners) -->
        <div
          v-if="canManageMembers"
          class="flex gap-2 items-end border-b border-neutral-200 dark:border-neutral-700 pb-6 mb-6"
        >
          <UFormField
            label="Email Address"
            class="flex-1"
          >
            <UInput
              v-model="inviteEmail"
              placeholder="colleague@example.com"
              icon="i-lucide-mail"
            />
          </UFormField>
          <UFormField
            label="Role"
            class="w-40"
          >
            <UDropdownMenu
              :items="roles.map(r => ({
                label: r.label,
                type: 'checkbox',
                checked: inviteRole === r.value,
                onUpdateChecked: () => { inviteRole = r.value }
              }))"
              arrow
            >
              <UButton
                :label="roles.find(r => r.value === inviteRole)?.label || 'Select role'"
                variant="outline"
                size="sm"
                icon="i-lucide-chevron-down"
                trailing
                block
                class="cursor-pointer"
              />
            </UDropdownMenu>
          </UFormField>
          <UButton
            :loading="loading"
            icon="i-lucide-send"
            class="cursor-pointer"
            @click="inviteMember"
          >
            Invite
          </UButton>
        </div>

        <!-- Members List -->
        <div class="space-y-3">
          <div
            v-for="member in activeOrg.data.members"
            :key="member.id"
            class="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <div class="flex items-center gap-3">
              <UAvatar
                :src="member.user.image"
                :alt="member.user.name"
                size="sm"
              />
              <div>
                <div class="font-medium">
                  {{ member.user.name }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ member.user.email }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <!-- Role Badge (always show for non-owners when can't manage, or for owners) -->
              <UBadge
                v-if="!canManageMembers || member.role === 'owner'"
                :color="member.role === 'owner' ? 'primary' : 'gray'"
              >
                {{ member.role }}
              </UBadge>

              <!-- Role Dropdown (Only for admins/owners managing non-owners) -->
              <UDropdownMenu
                v-else
                :items="roles.filter(r => r.value !== 'owner').map(r => ({
                  label: r.label,
                  type: 'checkbox',
                  checked: member.role === r.value,
                  onUpdateChecked: () => updateMemberRole(member.id, r.value)
                }))"
                arrow
              >
                <UButton
                  :label="member.role"
                  variant="outline"
                  size="xs"
                  icon="i-lucide-chevron-down"
                  trailing
                  class="cursor-pointer"
                />
              </UDropdownMenu>

              <!-- Actions (Only for admins/owners managing non-owners) -->
              <UDropdownMenu
                v-if="canManageMembers && member.role !== 'owner'"
                :items="[[{
                  label: 'Remove from team',
                  icon: 'i-lucide-user-minus',
                  class: 'text-red-600 cursor-pointer',
                  onSelect: () => removeMember(member.id)
                }]]"
              >
                <UButton
                  icon="i-lucide-more-horizontal"
                  variant="ghost"
                  size="xs"
                  color="gray"
                  class="cursor-pointer"
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Invitations List -->
      <UCard v-if="activeOrg.data.invitations.some(i => i.status === 'pending')">
        <template #header>
          <h3 class="text-lg font-semibold">
            Pending Invitations
          </h3>
        </template>
        <div class="space-y-4">
          <div
            v-for="invitation in activeOrg.data.invitations.filter(i => i.status === 'pending')"
            :key="invitation.id"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-3">
              <div class="bg-primary/10 p-2 rounded-full">
                <UIcon
                  name="i-lucide-mail"
                  class="w-4 h-4 text-primary"
                />
              </div>
              <div>
                <div class="font-medium">
                  {{ invitation.email }}
                </div>
                <div class="text-xs text-muted-foreground">
                  Role: {{ invitation.role }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-copy"
                color="gray"
                variant="ghost"
                size="xs"
                class="cursor-pointer"
                @click="copyLink(invitation.id)"
              >
                Copy Link
              </UButton>
              <UButton
                v-if="canManageMembers"
                icon="i-lucide-x"
                color="error"
                variant="ghost"
                size="xs"
                class="cursor-pointer"
                @click="revokeInvitation(invitation.id)"
              >
                Revoke
              </UButton>
              <UBadge color="orange">
                {{ invitation.status }}
              </UBadge>
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
