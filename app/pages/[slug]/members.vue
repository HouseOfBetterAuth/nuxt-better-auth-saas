<script setup lang="ts">
/**
 * Members Page
 * Uses extracted components for maintainability:
 * - MembersInviteForm: Invite form with seat/upgrade logic
 */
import { useClipboard } from '@vueuse/core'

definePageMeta({
  layout: 'default'
})

const { organization, useActiveOrganization, session, user, fetchSession, refreshActiveOrg } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

const loading = ref(false)

// Get subscription data from activeOrg
const subscriptionData = computed(() => {
  const subs = (activeOrg.value?.data as any)?.subscriptions
  if (!subs || !Array.isArray(subs))
    return null
  return subs.find((s: any) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')
})

// Check if current user is admin or owner
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find((m: any) => m.userId === user.value?.id)
  return member?.role || null
})

const canManageMembers = computed(() => {
  return currentUserRole.value === 'admin' || currentUserRole.value === 'owner'
})

const isPro = computed(() => {
  return subscriptionData.value !== null && subscriptionData.value !== undefined
})

// Check if we need to set an active org on mount
onMounted(async () => {
  if (!(session.value as any)?.activeOrganizationId) {
    const { data } = await organization.list()
    if (data && data.length > 0 && data[0]?.id) {
      await organization.setActive({ organizationId: data[0].id })
      await fetchSession()
    } else {
      await navigateTo('/')
    }
  }
})

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

async function refreshPage() {
  loading.value = true
  try {
    await fetchSession()
    await refreshActiveOrg()
    toast.add({ title: 'Data refreshed', color: 'success' })
  } catch {
    toast.add({ title: 'Error refreshing data', color: 'error' })
  } finally {
    loading.value = false
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

    toast.add({ title: 'Role updated', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
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
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to remove this member?'))
    return

  loading.value = true
  try {
    const { error } = await organization.removeMember({
      organizationId: activeOrg.value.data.id,
      memberIdOrEmail: memberId
    })

    if (error)
      throw error

    toast.add({ title: 'Member removed', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
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

async function revokeInvitation(invitationId: string) {
  if (!activeOrg.value?.data?.id)
    return
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to revoke this invitation?'))
    return

  loading.value = true
  try {
    const { error } = await organization.cancelInvitation({ invitationId })

    if (error)
      throw error

    toast.add({ title: 'Invitation revoked', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
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

const roles = [
  { label: 'Member', value: 'member' },
  { label: 'Admin', value: 'admin' },
  { label: 'Owner', value: 'owner' }
]
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-3xl font-semibold">
        Team Members
      </h1>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        color="neutral"
        :loading="loading"
        @click="refreshPage"
      />
    </div>

    <div v-if="activeOrg?.data">
      <UCard>
        <template #header>
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">
              {{ activeOrg.data.name }} Members
            </h3>
            <UBadge color="neutral">
              {{ activeOrg.data.members.length }} {{ activeOrg.data.members.length === 1 ? 'member' : 'members' }}
            </UBadge>
          </div>
        </template>

        <!-- Invite Form Component -->
        <MembersInviteForm
          :can-manage="canManageMembers"
          :is-pro="isPro"
          @refresh="refreshPage"
        />

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
              <!-- Role Badge -->
              <UBadge
                v-if="!canManageMembers || member.role === 'owner'"
                :color="member.role === 'owner' ? 'primary' : 'neutral'"
              >
                {{ member.role }}
              </UBadge>

              <!-- Role Dropdown -->
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

              <!-- Actions -->
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
                  color="neutral"
                  class="cursor-pointer"
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Invitations List -->
      <UCard
        v-if="activeOrg.data.invitations.some((i: any) => i.status === 'pending')"
        class="mt-6"
      >
        <template #header>
          <h3 class="text-lg font-semibold">
            Pending Invitations
          </h3>
        </template>
        <div class="space-y-4">
          <div
            v-for="invitation in activeOrg.data.invitations.filter((i: any) => i.status === 'pending')"
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
                variant="ghost"
                size="xs"
                color="neutral"
                class="cursor-pointer"
                @click="copyLink(invitation.id)"
              />
              <UButton
                v-if="canManageMembers"
                icon="i-lucide-x"
                variant="ghost"
                size="xs"
                color="error"
                class="cursor-pointer"
                @click="revokeInvitation(invitation.id)"
              />
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
