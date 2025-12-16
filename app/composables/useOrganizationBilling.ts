import type { Subscription } from '@better-auth/stripe'
import type { OwnershipInfo } from '~~/shared/utils/organizationExtras'
import { computed, watch } from 'vue'
import { computeNeedsUpgrade, computeUserOwnsMultipleOrgs } from '~~/shared/utils/organizationExtras'

interface BillingState {
  subscriptions: Subscription[]
  ownershipInfo: OwnershipInfo | null
  lastOrgId: string | null
  loading: boolean
}

const fetchOwnershipInfo = async () => {
  try {
    return await $fetch<OwnershipInfo>('/api/organization/ownership-info', {
      credentials: 'include'
    })
  } catch (error) {
    console.error('[useOrganizationBilling] Failed to fetch ownership info', error)
    throw error
  }
}

export function useOrganizationBilling() {
  const { subscription, useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()

  const state = useState<BillingState>('organization:billing-state', () => ({
    subscriptions: [],
    ownershipInfo: null,
    lastOrgId: null,
    loading: false
  }))

  const initialized = useState<boolean>('organization:billing-initialized', () => false)

  const loadSubscriptions = async (organizationId: string): Promise<Subscription[]> => {
    const { data, error } = await subscription.list({
      query: { referenceId: organizationId }
    })

    if (error) {
      throw error
    }

    return Array.isArray(data) ? (data as Subscription[]) : []
  }

  const refresh = async (orgId?: string | null) => {
    const organizationId = orgId ?? activeOrg.value?.data?.id ?? null
    if (!organizationId) {
      state.value = {
        subscriptions: [],
        ownershipInfo: null,
        lastOrgId: null,
        loading: false
      }
      return state.value
    }

    state.value.loading = true
    try {
      const [subscriptions, ownershipInfo] = await Promise.all([
        loadSubscriptions(organizationId),
        fetchOwnershipInfo()
      ])

      state.value = {
        subscriptions,
        ownershipInfo,
        lastOrgId: organizationId,
        loading: false
      }

      return state.value
    } catch (error) {
      console.error('[useOrganizationBilling] Failed to refresh billing data', error)
      state.value = {
        subscriptions: [],
        ownershipInfo: null,
        lastOrgId: organizationId,
        loading: false
      }
      throw error
    }
  }

  if (!initialized.value) {
    initialized.value = true
    watch(
      () => activeOrg.value?.data?.id,
      (orgId) => {
        if (!orgId) {
          state.value = {
            subscriptions: [],
            ownershipInfo: null,
            lastOrgId: null,
            loading: false
          }
          return
        }

        if (state.value.lastOrgId !== orgId) {
          refresh(orgId).catch((error) => {
            console.error('[useOrganizationBilling] Failed to auto refresh billing data', error)
          })
        }
      },
      { immediate: true }
    )
  }

  const subscriptions = computed(() => state.value.subscriptions)
  const ownershipInfo = computed(() => state.value.ownershipInfo)
  const activeSubscription = computed(() => {
    const subs = subscriptions.value
    if (!Array.isArray(subs) || subs.length === 0)
      return null

    return subs.find((sub: any) => ['active', 'trialing', 'past_due'].includes(sub.status as string)) ?? null
  })

  const isPaymentFailed = computed(() => activeSubscription.value?.status === 'past_due')
  const userOwnsMultipleOrgs = computed(() => computeUserOwnsMultipleOrgs(ownershipInfo.value))
  const needsUpgrade = computed(() => computeNeedsUpgrade(activeOrg.value?.data?.id, subscriptions.value, ownershipInfo.value))
  const hasUsedTrial = computed(() => {
    if (userOwnsMultipleOrgs.value)
      return true

    const subs = subscriptions.value
    if (!subs || subs.length === 0)
      return false

    return subs.some((sub: any) => Boolean(sub.trialStart || sub.trialEnd || sub.status === 'trialing'))
  })

  return {
    subscriptions,
    ownershipInfo,
    activeSubscription,
    needsUpgrade,
    userOwnsMultipleOrgs,
    hasUsedTrial,
    isPaymentFailed,
    refresh,
    loading: computed(() => state.value.loading)
  }
}
