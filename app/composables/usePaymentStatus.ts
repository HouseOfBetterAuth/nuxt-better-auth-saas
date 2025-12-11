import { watch } from 'vue'

/**
 * Composable for checking subscription payment status
 * Used across the app to detect failed payments and trial usage
 */
export function usePaymentStatus() {
  const { useActiveOrganization, activeOrgExtras, refreshActiveOrganizationExtras } = useAuth()
  const activeOrg = useActiveOrganization()

  if (import.meta.client) {
    watch(
      () => activeOrg.value?.data?.id,
      (orgId) => {
        refreshActiveOrganizationExtras(orgId)
      },
      { immediate: true }
    )
  }

  // Get all subscriptions for the active organization
  const subscriptions = computed(() => activeOrgExtras.value.subscriptions || [])

  // Find the active subscription (including past_due)
  // Note: 'incomplete' subscriptions are NOT valid - they occur when checkout is abandoned
  const activeSub = computed(() => {
    const subs = subscriptions.value as any[]
    if (!subs || subs.length === 0)
      return null
    // Only return subscriptions with valid statuses - do NOT fallback to incomplete/canceled
    return subs.find(
      (s: any) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due'
    ) || null
  })

  // Check if subscription has a failed payment
  const isPaymentFailed = computed(() => activeSub.value?.status === 'past_due')

  // Check if user should NOT get a free trial
  // True if user owns multiple orgs (only first org gets trial)
  const hasUsedTrial = computed(() => {
    if (activeOrgExtras.value.userOwnsMultipleOrgs)
      return true
    // Fallback to checking current org's subscriptions
    const subs = subscriptions.value as any[]
    if (!subs || subs.length === 0)
      return false
    return subs.some((s: any) => s.trialStart || s.trialEnd || s.status === 'trialing')
  })

  // Current plan type
  const currentPlan = computed(() => {
    if (activeSub.value) {
      return 'pro'
    }
    return 'free'
  })

  // Organization ID helper
  const organizationId = computed(() => activeOrg.value?.data?.id)
  const organizationSlug = computed(() => activeOrg.value?.data?.slug)

  return {
    subscriptions,
    activeSub,
    isPaymentFailed,
    hasUsedTrial,
    currentPlan,
    organizationId,
    organizationSlug
  }
}
