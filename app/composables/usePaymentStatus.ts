import { useOrganizationBilling } from './useOrganizationBilling'

/**
 * Composable for checking subscription payment status
 * Centralizes logic for Stripe subscription state + upgrade helpers
 */
export function usePaymentStatus() {
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()
  const {
    subscriptions,
    activeSubscription,
    needsUpgrade,
    hasUsedTrial,
    isPaymentFailed,
    refresh
  } = useOrganizationBilling()

  const currentPlan = computed(() => (activeSubscription.value ? 'pro' : 'free'))
  const organizationId = computed(() => activeOrg.value?.data?.id)
  const organizationSlug = computed(() => activeOrg.value?.data?.slug)

  return {
    subscriptions,
    activeSub: activeSubscription,
    isPaymentFailed,
    hasUsedTrial,
    needsUpgrade,
    currentPlan,
    organizationId,
    organizationSlug,
    refresh
  }
}
