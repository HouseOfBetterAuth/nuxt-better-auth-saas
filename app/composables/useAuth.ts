import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, anonymousClient, apiKeyClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { watch } from 'vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

interface OwnershipInfo {
  ownedCount: number
  firstOwnedOrgId: string | null
}

interface ActiveOrgExtras {
  subscriptions: any[]
  needsUpgrade: boolean
  userOwnsMultipleOrgs: boolean
}

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders() : undefined
  const runtimeConfig = useRuntimeConfig()
  const payment = runtimeConfig.public.payment as 'stripe'
  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers
    },
    plugins: [
      inferAdditionalFields({
        user: {
          referralCode: {
            type: 'string',
            required: false
          }
        },
        apiKey: {
          organizationId: {
            type: 'string'
          }
        }
      }),
      adminClient(),
      anonymousClient(),
      organizationClient({
        ac,
        roles: {
          owner,
          admin,
          member
        },
        enableMetadata: true
      }),
      apiKeyClient(),
      stripeClient({
        subscription: true
      })
    ]
  })

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)
  const ownershipInfoState = useState<OwnershipInfo | null>('organization:ownership-info', () => null)
  const activeOrgExtras = useState<ActiveOrgExtras>('active-org-extras', () => ({
    subscriptions: [],
    needsUpgrade: false,
    userOwnsMultipleOrgs: false
  }))
  const useActiveOrganization = client.organization.useActiveOrganization
  const activeOrganization = useActiveOrganization()

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }
    sessionFetching.value = true

    let data: { session?: any, user?: any } | null = null
    try {
      data = await $fetch('/api/auth/get-session', {
        credentials: 'include',
        headers
      })
    } catch (error) {
      console.error('[useAuth] Failed to fetch session:', error)
      data = null
    }

    session.value = data?.session || null

    const userDefaults = {
      image: null,
      role: null,
      banReason: null,
      banned: null,
      banExpires: null,
      stripeCustomerId: null
    }
    user.value = data?.user
      ? Object.assign({}, userDefaults, data.user)
      : null

    if (user.value) {
      // Subscriptions are now fetched via activeOrg (SSR)
      // No need to fetch them here separately
    }
    sessionFetching.value = false
    return data
  }

  if (import.meta.client) {
    client.$store.listen('$sessionSignal', async (signal) => {
      if (!signal)
        return
      await fetchSession()
    })
  }

  const fetchOwnershipInfo = async (force = false) => {
    if (ownershipInfoState.value && !force) {
      return ownershipInfoState.value
    }

    try {
      const data = await $fetch<OwnershipInfo>('/api/organization/ownership-info', {
        credentials: 'include',
        headers
      })
      ownershipInfoState.value = data
      return data
    } catch (error) {
      console.error('Failed to fetch ownership info', error)
      ownershipInfoState.value = null
      throw error
    }
  }

  const fetchSubscriptions = async (organizationId: string) => {
    if (!organizationId)
      return []
    const { data, error } = await client.subscription.list({
      query: { referenceId: organizationId }
    })
    if (error) {
      throw error
    }
    return Array.isArray(data) ? data : []
  }

  const computeUserOwnsMultipleOrgs = (info?: OwnershipInfo | null) => Boolean(info && info.ownedCount > 1)

  const computeNeedsUpgrade = (organizationId: string | undefined, subs: any[], info?: OwnershipInfo | null) => {
    const hasActiveSub = Array.isArray(subs) && subs.some(sub => sub?.status === 'active' || sub?.status === 'trialing')
    if (!organizationId)
      return false
    if (!info)
      return !hasActiveSub
    return !hasActiveSub && info.firstOwnedOrgId !== organizationId
  }

  const refreshActiveOrganizationExtras = async (organizationId?: string | null) => {
    if (!organizationId) {
      activeOrgExtras.value = {
        subscriptions: [],
        needsUpgrade: false,
        userOwnsMultipleOrgs: false
      }
      return activeOrgExtras.value
    }
    try {
      const [subs, ownershipInfo] = await Promise.all([
        fetchSubscriptions(organizationId),
        fetchOwnershipInfo()
      ])
      const needsUpgrade = computeNeedsUpgrade(organizationId, subs, ownershipInfo)
      const userOwnsMultipleOrgs = computeUserOwnsMultipleOrgs(ownershipInfo)
      activeOrgExtras.value = {
        subscriptions: subs,
        needsUpgrade,
        userOwnsMultipleOrgs
      }
      return activeOrgExtras.value
    } catch (error) {
      console.error('Failed to refresh organization extras', error)
      return activeOrgExtras.value
    }
  }

  const extrasWatcherInitialized = useState<boolean>('active-org-extras:watcher-init', () => false)
  if (import.meta.client && !extrasWatcherInitialized.value) {
    extrasWatcherInitialized.value = true
    watch(
      () => activeOrganization.value?.data?.id,
      (orgId) => {
        refreshActiveOrganizationExtras(orgId)
      },
      { immediate: true }
    )
  }

  return {
    client,
    session,
    user,
    organization: client.organization,
    useActiveOrganization,
    subscription: client.subscription,
    activeOrgExtras,
    loggedIn: computed(() => Boolean(user.value && !user.value.isAnonymous)),
    activeStripeSubscription: computed(() => {
      const subs = activeOrgExtras.value.subscriptions || []
      if (!Array.isArray(subs))
        return undefined

      return subs.find(
        (sub: any) => sub.status === 'active' || sub.status === 'trialing'
      )
    }),
    refreshActiveOrganizationExtras,
    fetchOwnershipInfo,
    fetchSubscriptions,
    computeNeedsUpgrade,
    computeUserOwnsMultipleOrgs,
    signIn: client.signIn,
    signUp: client.signUp,
    forgetPassword: client.requestPasswordReset,
    resetPassword: client.resetPassword,
    sendVerificationEmail: client.sendVerificationEmail,
    errorCodes: client.$ERROR_CODES,
    async signOut({ redirectTo }: { redirectTo?: RouteLocationRaw } = {}) {
      await client.signOut({
        fetchOptions: {
          onSuccess: async () => {
            session.value = null
            user.value = null
            if (redirectTo) {
              await reloadNuxtApp({
                path: redirectTo.toString()
              })
            }
          }
        }
      })
    },
    fetchSession,
    payment
  }
}
