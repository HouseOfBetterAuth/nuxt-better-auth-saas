import type { Subscription } from '@better-auth/stripe'
import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { stripeClient } from '@better-auth/stripe/client'
import { watchDebounced } from '@vueuse/core'
import { adminClient, anonymousClient, apiKeyClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'
import type { User } from '~~/shared/utils/types'
import {
  computeNeedsUpgrade,
  computeUserOwnsMultipleOrgs,
  createEmptyActiveOrgExtras,
  type ActiveOrgExtras,
  type OwnershipInfo
} from '~~/shared/utils/organizationExtras'

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
  const ownershipInfoState = useState<OwnershipInfo | null>('organization:ownership-info', () => null)
  const activeOrgExtras = useState<ActiveOrgExtras<Subscription>>('active-org-extras', () => createEmptyActiveOrgExtras<Subscription>())
  const latestOrgFetchId = useState<string | null>('active-org-extras:latest-fetch', () => null)
  const sharedActiveOrganization = useState<any>('auth:active-organization:data', () => null)
  const clientActiveOrganization = import.meta.client
    ? useState<ReturnType<typeof client.organization.useActiveOrganization> | null>('auth:active-organization:client-source', () => null)
    : null

  const resolveActiveOrganization = () => {
    if (import.meta.client) {
      if (clientActiveOrganization!.value === null) {
        const source = client.organization.useActiveOrganization()
        clientActiveOrganization!.value = source
        watch(
          source,
          (org) => {
            sharedActiveOrganization.value = org ?? null
          },
          { immediate: true, deep: false }
        )
      }

      return computed(() => {
        const sourceValue = clientActiveOrganization!.value?.value
        if (sourceValue) {
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

  const refreshActiveOrganizationExtras = async (organizationId?: string | null) => {
    if (!organizationId) {
      activeOrgExtras.value = createEmptyActiveOrgExtras()
      return activeOrgExtras.value
    }
    latestOrgFetchId.value = organizationId
    try {
      const [subs, ownershipInfo] = await Promise.all([
        fetchSubscriptions(organizationId),
        fetchOwnershipInfo()
      ])
      if (latestOrgFetchId.value !== organizationId) {
        return activeOrgExtras.value
      }
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
    let isInitialLoad = true
    watchDebounced(
      () => activeOrganization.value?.data?.id,
      async (orgId) => {
        if (!orgId || isInitialLoad) {
          isInitialLoad = false
          return
        }
        await refreshActiveOrganizationExtras(orgId)
      },
      { immediate: true, debounce: 300 }
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
      const subs = activeOrgExtras.value?.subscriptions || []
      if (!Array.isArray(subs))
        return undefined

      return subs.find(
        (sub: any) => sub.status === 'active' || sub.status === 'trialing'
      )
    }),
    refreshActiveOrganizationExtras,
    fetchOwnershipInfo,
    fetchSubscriptions,
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
