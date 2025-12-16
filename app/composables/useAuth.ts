import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import type { User } from '~~/shared/utils/types'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, anonymousClient, apiKeyClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { computed, isRef, ref, watch } from 'vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

export const AUTH_USER_DEFAULTS: Partial<User> = {
  image: null,
  role: null,
  banReason: null,
  banned: null,
  banExpires: null,
  stripeCustomerId: null
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
  const sharedActiveOrganization = useState<any>('auth:active-organization:data', () => null)
  const activeOrgWatcherInitialized = import.meta.client
    ? useState<boolean>('auth:active-organization:watcher-initialized', () => false)
    : null
  const activeOrgInitPending = import.meta.client
    ? useState<boolean>('auth:active-organization:init-pending', () => false)
    : null
  const clientActiveOrganization = import.meta.client
    ? useState<ReturnType<typeof client.organization.useActiveOrganization> | null>('auth:active-organization:client-source', () => null)
    : null

  const resolveSourceValue = (source: any) => {
    if (!source) {
      return null
    }
    if ('value' in source && source.value !== undefined) {
      return isRef(source.value) ? source.value.value : source.value
    }
    if (isRef(source)) {
      return source.value
    }
    if ('data' in source) {
      const data = source.data
      return isRef(data) ? data.value : data
    }
    return source
  }

  const isPromiseLike = <T>(value: any): value is Promise<T> =>
    Boolean(value) && typeof value === 'object' && typeof value.then === 'function'

  const attachActiveOrgWatcher = (source: any) => {
    if (!source || !activeOrgWatcherInitialized || activeOrgWatcherInitialized.value)
      return
    watch(
      () => resolveSourceValue(source),
      (org) => {
        sharedActiveOrganization.value = org ?? null
      },
      { immediate: true, deep: false }
    )
    activeOrgWatcherInitialized.value = true
  }

  const initializeClientActiveOrganizationSource = () => {
    if (!import.meta.client || !clientActiveOrganization)
      return

    if (clientActiveOrganization.value) {
      attachActiveOrgWatcher(clientActiveOrganization.value)
      return
    }

    if (activeOrgInitPending?.value)
      return

    activeOrgInitPending!.value = true
    const rawSource = client.organization.useActiveOrganization()
    const handleResolved = (resolved: any) => {
      clientActiveOrganization.value = resolved
      attachActiveOrgWatcher(resolved)
      activeOrgInitPending!.value = false
    }

    if (isPromiseLike(rawSource)) {
      rawSource
        .then(handleResolved)
        .catch((error) => {
          console.error('[useAuth] Failed to initialize active organization source', error)
          activeOrgInitPending!.value = false
        })
    } else {
      handleResolved(rawSource)
    }
  }

  const resolveActiveOrganization = () => {
    if (import.meta.client) {
      initializeClientActiveOrganizationSource()

      return computed(() => {
        const sourceRef = clientActiveOrganization!.value
        const sourceValue = resolveSourceValue(sourceRef)
        if (sourceValue !== undefined && sourceValue !== null) {
          return sourceValue
        }
        return sharedActiveOrganization.value
      })
    }

    return computed(() => {
      return sharedActiveOrganization.value
    })
  }

  const activeOrganization = resolveActiveOrganization()
  const useActiveOrganization = () => activeOrganization

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }
    sessionFetching.value = true

    let data: { session?: any, user?: any } | null = null
    try {
      if (import.meta.server) {
        const event = useRequestEvent()
        if (event?.context?.authSession) {
          data = {
            session: event.context.authSession.session,
            user: event.context.authSession.user
          }
        } else if (event) {
          const { getAuthSession } = await import('~~/server/utils/auth')
          const serverSession = await getAuthSession(event)
          event.context.authSession = serverSession
          data = serverSession
            ? {
                session: serverSession.session,
                user: serverSession.user
              }
            : null
        } else {
          data = {
            session: session.value,
            user: user.value
          }
        }
      } else {
        data = await $fetch('/api/auth/get-session', {
          credentials: 'include',
          headers
        })
      }
    } catch (error) {
      console.error('[useAuth] Failed to fetch session:', error)
      data = null
    }

    session.value = data?.session || null
    user.value = data?.user
      ? Object.assign({}, AUTH_USER_DEFAULTS, data.user)
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

  return {
    client,
    session,
    user,
    organization: client.organization,
    useActiveOrganization,
    subscription: client.subscription,
    loggedIn: computed(() => Boolean(user.value && !user.value.isAnonymous)),
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
