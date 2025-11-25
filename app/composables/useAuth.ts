import type { Subscription } from '@better-auth/stripe'
import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders() : undefined
  const runtimeConfig = useRuntimeConfig()
  const payment = runtimeConfig.public.payment as 'stripe' | 'polar'
  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers
    },
    plugins: [
      inferAdditionalFields({
        user: {
          polarCustomerId: {
            type: 'string'
          }
        }
      }),
      adminClient(),
      organizationClient(),
      stripeClient({
        subscription: true
      })
    ]
  })

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const subscriptions = useState<Subscription[]>('auth:subscriptions', () => [])
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)

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
    subscriptions.value = []
    if (user.value) {
      try {
        if (payment == 'stripe') {
          const activeOrgId = data?.session?.activeOrganizationId
          const { data: subscriptionData } = await client.subscription.list({
            query: activeOrgId ? { referenceId: activeOrgId } : undefined
          })
          subscriptions.value = subscriptionData || []
        }
      } catch (error) {
        // Ignore subscription fetch errors (e.g., 404 if not configured)
        console.debug('Subscription fetch failed:', error)
      }
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

  return {
    session,
    user,
    organization: client.organization,
    useActiveOrganization: client.useActiveOrganization,
    subscription: client.subscription,
    subscriptions,
    loggedIn: computed(() => !!session.value),
    activeStripeSubscription: computed(() => {
      return subscriptions.value.find(
        sub => sub.status === 'active' || sub.status === 'trialing'
      )
    }),
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
    payment,
    client
  }
}
