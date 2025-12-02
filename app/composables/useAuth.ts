import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, apiKeyClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

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

  // Create global state for active organization (SSR friendly)
  const useActiveOrgState = () => useState<any>('active-org-state', () => ({ data: null }))

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)

  // Subscriptions are derived from the active org state
  const subscriptions = computed(() => {
    const activeOrgState = useActiveOrgState()
    return (activeOrgState.value?.data as any)?.subscriptions || []
  })

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }
    sessionFetching.value = true

    // Use useFetch for better SSR support and hydration
    const { data: sessionData } = await useFetch('/api/auth/get-session', {
      headers: import.meta.server ? useRequestHeaders() : undefined,
      key: 'auth-session',
      retry: 0
    })

    const data = sessionData.value
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

  const useActiveOrganization = () => {
    const state = useActiveOrgState()
    return state
  }

  // Centralized function to refresh organization data
  const refreshActiveOrg = async () => {
    try {
      // Add cache-busting timestamp to bypass any HTTP/CDN caching
      const orgData: any = await $fetch(`/api/organization/full-data?_t=${Date.now()}`)

      // Flatten the structure to match what components expect
      // orgData comes as { organization: {...}, subscriptions: [...], userOwnsMultipleOrgs: bool, user: ... }
      // We want activeOrg.value.data to be { ...organization, subscriptions: [...], userOwnsMultipleOrgs: bool }
      const flattenedData = {
        ...orgData.organization,
        subscriptions: orgData.subscriptions,
        userOwnsMultipleOrgs: orgData.userOwnsMultipleOrgs,
        needsUpgrade: orgData.needsUpgrade
      }

      const state = useActiveOrgState()
      if (state.value) {
        state.value.data = flattenedData
      } else {
        state.value = { data: flattenedData }
      }
      return flattenedData
    } catch (error) {
      console.error('Failed to refresh active org:', error)
      return null
    }
  }

  return {
    client,
    session,
    user,
    organization: client.organization,
    useActiveOrganization, // Use our singleton wrapper
    subscription: client.subscription,
    subscriptions,
    loggedIn: computed(() => !!session.value),
    activeStripeSubscription: computed(() => {
      const activeOrgState = useActiveOrgState()
      const subs = (activeOrgState.value?.data as any)?.subscriptions || []
      if (!Array.isArray(subs))
        return undefined

      return subs.find(
        (sub: any) => sub.status === 'active' || sub.status === 'trialing'
      )
    }),
    refreshActiveOrg,
    signIn: client.signIn,
    signUp: client.signUp,
    forgetPassword: client.forgetPassword,
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
