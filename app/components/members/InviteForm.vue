<script setup lang="ts">
/**
 * Member Invite Form Component
 * Handles inviting members with seat limit checking, trial conversion, and upgrade flows
 *
 * Usage: <MembersInviteForm :can-manage="canManageMembers" :is-pro="isPro" />
 */
import { PLANS } from '~~/shared/utils/plans'

const { canManage, isPro } = defineProps<{
  canManage?: boolean
  isPro?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { organization, useActiveOrganization, fetchSession, refreshActiveOrg, activeStripeSubscription, user, client } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { hasUsedTrial } = usePaymentStatus()

const inviteEmail = ref('')
const inviteRole = ref('member')
const loading = ref(false)
const showUpgradeModal = ref(false)
const showAddSeatModal = ref(false)
const showContactOwnerModal = ref(false)
const addSeatPreview = ref<any>(null)
const seatInterval = ref<'month' | 'year'>('month')
const isEndingTrial = ref(false)
const errorMessage = ref('')
const paymentError = ref(false)
const portalLoading = ref(false)

// Check if current user is owner (can manage billing)
const isOwner = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return false
  const member = activeOrg.value.data.members.find((m: any) => m.userId === user.value?.id)
  return member?.role === 'owner'
})

const roles = [
  { label: 'Member', value: 'member' },
  { label: 'Admin', value: 'admin' },
  { label: 'Owner', value: 'owner' }
]

// Find the config for the user's actual current plan to support legacy pricing
const currentSubPlanConfig = computed(() => {
  if (!activeStripeSubscription.value)
    return null
  const match = Object.values(PLANS).find(p => p.id === activeStripeSubscription.value?.plan)
  return match
})

const nextChargeDate = computed(() => {
  if ((activeStripeSubscription.value as any)?.periodEnd) {
    return new Date((activeStripeSubscription.value as any).periodEnd).toLocaleDateString()
  }
  return null
})

// Helper to get the correct plan config for calculations
function getPlanConfigForInterval(interval: 'month' | 'year') {
  if (currentSubPlanConfig.value && currentSubPlanConfig.value.interval === interval) {
    return currentSubPlanConfig.value
  }
  return interval === 'year' ? PLANS.PRO_YEARLY : PLANS.PRO_MONTHLY
}

async function inviteMember() {
  try {
    if (!inviteEmail.value || !activeOrg.value?.data?.id)
      return

    const hasPro = !!activeStripeSubscription.value
    const isTrialing = activeStripeSubscription.value?.status === 'trialing'

    if (isTrialing) {
      // Only owners can end trial and add seats
      if (!isOwner.value) {
        showContactOwnerModal.value = true
        return
      }
      await openAddSeatModal()
      return
    }

    const currentMemberCount = activeOrg.value.data.members.length
    const pendingInvitesCount = activeOrg.value.data.invitations.filter((i: any) => i.status === 'pending').length
    const totalCount = currentMemberCount + pendingInvitesCount

    if (!hasPro && totalCount >= 1) {
      // Only owners can upgrade
      if (!isOwner.value) {
        showContactOwnerModal.value = true
        return
      }
      showUpgradeModal.value = true
      return
    }

    if (hasPro) {
      const purchasedSeats = Number(activeStripeSubscription.value?.seats) || 1
      if (totalCount + 1 > purchasedSeats) {
        // Only owners can add seats
        if (!isOwner.value) {
          showContactOwnerModal.value = true
          return
        }
        await openAddSeatModal()
        return
      }
    }

    loading.value = true

    const { error } = await organization.inviteMember({
      email: inviteEmail.value,
      role: inviteRole.value as 'member' | 'admin' | 'owner',
      organizationId: activeOrg.value.data.id
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation sent', color: 'success' })
    inviteEmail.value = ''
    await fetchSession()
    await refreshActiveOrg()
    emit('refresh')
  } catch (e: any) {
    console.error('InviteMember Error:', e)
    toast.add({
      title: 'Error inviting member',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function openAddSeatModal() {
  if (!activeStripeSubscription.value)
    return

  isEndingTrial.value = activeStripeSubscription.value.status === 'trialing'
  seatInterval.value = (activeStripeSubscription.value.plan === PLANS.PRO_YEARLY.id || activeStripeSubscription.value.plan?.includes('year')) ? 'year' : 'month'
  paymentError.value = false // Reset payment error when opening modal

  showAddSeatModal.value = true
  await fetchSeatPreview()
}

async function fetchSeatPreview() {
  loading.value = true
  errorMessage.value = ''
  addSeatPreview.value = null

  try {
    const currentSeats = activeStripeSubscription.value?.seats || 1

    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value!.data!.id,
        seats: currentSeats + 1,
        newInterval: isEndingTrial.value ? seatInterval.value : undefined
      }
    })
    addSeatPreview.value = preview
  } catch (e: any) {
    errorMessage.value = e.data?.message || e.message || 'Failed to load preview.'
    toast.add({
      title: 'Error loading preview',
      description: errorMessage.value,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

watch(seatInterval, () => {
  if (isEndingTrial.value) {
    fetchSeatPreview()
  }
})

async function confirmAddSeat() {
  if (!activeStripeSubscription.value)
    return

  loading.value = true
  try {
    const currentSeats = activeStripeSubscription.value.seats || 1
    const newSeats = currentSeats + 1

    await $fetch('/api/stripe/update-seats', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value!.data!.id,
        seats: newSeats,
        endTrial: isEndingTrial.value,
        newInterval: isEndingTrial.value ? seatInterval.value : undefined
      }
    })

    toast.add({
      title: 'Seat added successfully',
      description: `You now have ${newSeats} seats.`,
      color: 'success'
    })

    showAddSeatModal.value = false
    await fetchSession()
    await refreshActiveOrg()
    emit('refresh')
  } catch (e: any) {
    console.error(e)
    const message = e.data?.message || e.message || 'Unknown error'
    // Check if this is a payment-related error
    const isPaymentError = message.toLowerCase().includes('card')
      || message.toLowerCase().includes('payment')
      || message.toLowerCase().includes('declined')
    paymentError.value = isPaymentError
    toast.add({
      title: 'Failed to add seat',
      description: isPaymentError ? 'Your card was declined. Please update your payment method.' : message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function openBillingPortal() {
  if (!activeOrg.value?.data?.id)
    return

  portalLoading.value = true
  try {
    const { url } = await $fetch('/api/stripe/portal', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        returnUrl: window.location.href
      }
    })
    if (url) {
      window.location.href = url
    }
  } catch (e: any) {
    toast.add({
      title: 'Failed to open billing portal',
      description: e.data?.message || e.message,
      color: 'error'
    })
  } finally {
    portalLoading.value = false
  }
}

async function handleUpgrade() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true
  try {
    const currentMembers = activeOrg.value.data.members.length || 1
    const pendingInvites = activeOrg.value.data.invitations.filter((i: any) => i.status === 'pending').length
    const inviteCount = inviteEmail.value ? 1 : 0
    const quantity = currentMembers + pendingInvites + inviteCount

    // Use no-trial plan if user owns multiple orgs
    let planId = seatInterval.value === 'month' ? PLANS.PRO_MONTHLY.id : PLANS.PRO_YEARLY.id
    if (hasUsedTrial.value) {
      planId = `${planId}-no-trial`
    }

    const { error } = await client.subscription.upgrade({
      plan: planId,
      referenceId: activeOrg.value.data.id,
      metadata: {
        quantity: quantity > 0 ? quantity : 1
      },
      successUrl: `${window.location.origin}/${activeOrg.value.data.slug}/members?success=true${inviteEmail.value ? `&pendingInviteEmail=${encodeURIComponent(inviteEmail.value)}&pendingInviteRole=${inviteRole.value}` : ''}`,
      cancelUrl: `${window.location.origin}/${activeOrg.value.data.slug}/members?canceled=true`
    })

    if (error)
      throw error
  } catch (e: any) {
    console.error(e)
    toast.add({
      title: 'Failed to start checkout',
      description: e.data?.message || e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    v-if="canManage"
    class="border-b border-neutral-200 dark:border-neutral-700 pb-6 mb-6"
  >
    <!-- Pro User Invite Form -->
    <div
      v-if="isPro"
      class="space-y-3"
    >
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Invite a team member</label>

      <!-- Desktop: Single row layout -->
      <div class="hidden sm:flex items-center gap-2 p-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500 transition-all">
        <!-- Email Input -->
        <div class="flex-1 flex items-center gap-2 pl-2">
          <UIcon
            name="i-lucide-mail"
            class="w-4 h-4 text-gray-400 flex-shrink-0"
          />
          <input
            v-model="inviteEmail"
            type="email"
            placeholder="colleague@example.com"
            autocomplete="off"
            data-lpignore="true"
            data-form-type="other"
            class="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 py-2 min-w-0"
            @keydown.enter.prevent="!showAddSeatModal && !showUpgradeModal && !showContactOwnerModal && inviteMember()"
          >
        </div>

        <!-- Divider -->
        <div class="w-px h-6 bg-gray-200 dark:bg-gray-600" />

        <!-- Role Selector -->
        <UDropdownMenu
          :items="roles.map(r => ({
            label: r.label,
            icon: r.value === 'owner' ? 'i-lucide-crown' : r.value === 'admin' ? 'i-lucide-shield' : 'i-lucide-user',
            type: 'checkbox',
            checked: inviteRole === r.value,
            onUpdateChecked: () => { inviteRole = r.value }
          }))"
        >
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50"
          >
            <UIcon
              :name="inviteRole === 'owner' ? 'i-lucide-crown' : inviteRole === 'admin' ? 'i-lucide-shield' : 'i-lucide-user'"
              class="w-4 h-4"
            />
            <span>{{ roles.find(r => r.value === inviteRole)?.label }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="w-3.5 h-3.5 text-gray-400"
            />
          </button>
        </UDropdownMenu>

        <!-- Divider -->
        <div class="w-px h-6 bg-gray-200 dark:bg-gray-600" />

        <!-- Invite Button -->
        <UButton
          :loading="loading"
          :disabled="!inviteEmail"
          icon="i-lucide-user-plus"
          color="primary"
          size="sm"
          class="mr-1 cursor-pointer"
          @click="inviteMember"
        >
          Send Invite
        </UButton>
      </div>

      <!-- Mobile: Stacked layout -->
      <div class="sm:hidden space-y-3">
        <!-- Email Input -->
        <div class="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500 transition-all">
          <UIcon
            name="i-lucide-mail"
            class="w-4 h-4 text-gray-400 flex-shrink-0"
          />
          <input
            v-model="inviteEmail"
            type="email"
            placeholder="colleague@example.com"
            autocomplete="off"
            data-lpignore="true"
            data-form-type="other"
            class="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 min-w-0"
            @keydown.enter.prevent="!showAddSeatModal && !showUpgradeModal && !showContactOwnerModal && inviteMember()"
          >
        </div>

        <!-- Role + Button Row -->
        <div class="flex items-center gap-2">
          <!-- Role Selector -->
          <UDropdownMenu
            :items="roles.map(r => ({
              label: r.label,
              icon: r.value === 'owner' ? 'i-lucide-crown' : r.value === 'admin' ? 'i-lucide-shield' : 'i-lucide-user',
              type: 'checkbox',
              checked: inviteRole === r.value,
              onUpdateChecked: () => { inviteRole = r.value }
            }))"
          >
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            >
              <UIcon
                :name="inviteRole === 'owner' ? 'i-lucide-crown' : inviteRole === 'admin' ? 'i-lucide-shield' : 'i-lucide-user'"
                class="w-4 h-4"
              />
              <span>{{ roles.find(r => r.value === inviteRole)?.label }}</span>
              <UIcon
                name="i-lucide-chevron-down"
                class="w-3.5 h-3.5 text-gray-400"
              />
            </button>
          </UDropdownMenu>

          <!-- Invite Button -->
          <UButton
            :loading="loading"
            :disabled="!inviteEmail"
            icon="i-lucide-user-plus"
            color="primary"
            class="flex-1 cursor-pointer"
            @click="inviteMember"
          >
            Send Invite
          </UButton>
        </div>
      </div>

      <p class="text-xs text-gray-500 dark:text-gray-400">
        Press Enter to send or click the button
      </p>
    </div>

    <!-- Free User Upgrade Prompt -->
    <div
      v-else
      class="p-4 bg-gradient-to-r from-primary-50 to-primary-100/50 dark:from-primary-950/30 dark:to-primary-900/20 rounded-xl border border-primary-200/50 dark:border-primary-800/30"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-primary-100 dark:bg-primary-900/50 rounded-lg">
            <UIcon
              name="i-lucide-users"
              class="w-5 h-5 text-primary-600 dark:text-primary-400"
            />
          </div>
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Invite team members
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Upgrade to Pro to collaborate with your team
            </p>
          </div>
        </div>
        <UButton
          label="Upgrade"
          color="primary"
          icon="i-lucide-sparkles"
          class="cursor-pointer flex-shrink-0"
          @click="showUpgradeModal = true"
        />
      </div>
    </div>

    <!-- Upgrade Modal -->
    <BillingUpgradeModal
      v-model:open="showUpgradeModal"
      reason="invite"
      :organization-id="activeOrg?.data?.id"
      @upgraded="handleUpgrade"
    />

    <!-- Add Seat Modal -->
    <UModal
      v-model:open="showAddSeatModal"
      title="Add a Seat"
      :description="activeStripeSubscription?.status === 'trialing'
        ? 'You are currently in a trial. Adding a member will end your trial and start your subscription.'
        : 'You have used all your available seats. Add another seat to invite more members.'"
    >
      <template #body>
        <div
          v-if="activeStripeSubscription?.status === 'trialing'"
          class="mb-4"
        >
          <label class="block text-sm font-medium mb-3">Select billing cycle for your new plan</label>
          <div class="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 mb-4">
            <button
              class="flex-1 px-3 py-1 text-sm font-medium rounded-md transition-all"
              :class="seatInterval === 'month' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
              @click="seatInterval = 'month'"
            >
              Monthly
            </button>
            <button
              class="flex-1 px-3 py-1 text-sm font-medium rounded-md transition-all"
              :class="seatInterval === 'year' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
              @click="seatInterval = 'year'"
            >
              Yearly
            </button>
          </div>
        </div>

        <BillingSeatChangePreview
          v-if="addSeatPreview"
          :current-seats="activeStripeSubscription?.seats || 1"
          :target-seats="(activeStripeSubscription?.seats || 1) + 1"
          :plan-config="getPlanConfigForInterval(seatInterval)"
          :preview="addSeatPreview"
          :next-charge-date="nextChargeDate"
          :is-trialing="isEndingTrial"
        />

        <div
          v-else-if="errorMessage"
          class="py-4 flex flex-col items-center gap-2 text-center"
        >
          <UIcon
            name="i-lucide-alert-circle"
            class="w-8 h-8 text-red-500"
          />
          <p class="text-sm text-red-600">
            {{ errorMessage }}
          </p>
          <UButton
            label="Retry"
            size="sm"
            variant="outline"
            @click="fetchSeatPreview"
          />
        </div>

        <div
          v-else
          class="py-4 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-6 h-6 text-primary"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between w-full gap-2">
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancel"
              @click="showAddSeatModal = false"
            />
            <UButton
              :loading="loading"
              :label="activeStripeSubscription?.status === 'trialing' ? 'End Trial & Pay' : 'Add Seat & Pay'"
              color="primary"
              @click="confirmAddSeat"
            />
          </div>
          <UButton
            v-if="paymentError"
            label="Update Payment Method"
            color="orange"
            variant="soft"
            icon="i-lucide-credit-card"
            :loading="portalLoading"
            @click="openBillingPortal"
          />
        </div>
      </template>
    </UModal>

    <!-- Contact Owner Modal (for admins who can't manage billing) -->
    <UModal
      v-model:open="showContactOwnerModal"
      title="Additional Seats Required"
    >
      <template #body>
        <div class="text-center py-4">
          <div class="bg-amber-100 dark:bg-amber-900/20 p-3 rounded-full w-12 h-12 mx-auto mb-4 flex items-center justify-center">
            <UIcon
              name="i-lucide-users"
              class="w-6 h-6 text-amber-600 dark:text-amber-400"
            />
          </div>
          <p class="text-gray-600 dark:text-gray-300 mb-2">
            All available seats are in use.
          </p>
          <p class="text-sm text-gray-500">
            Please contact the team owner to add more seats or upgrade the plan.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          label="Got it"
          color="primary"
          block
          @click="showContactOwnerModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
