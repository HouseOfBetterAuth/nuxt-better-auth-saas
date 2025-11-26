const safeStorage = {
  get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch (error) {
      console.warn('[Billing Guard] Failed to read localStorage key', key, error)
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      console.warn('[Billing Guard] Failed to write localStorage key', key, error)
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.warn('[Billing Guard] Failed to remove localStorage key', key, error)
    }
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default defineNuxtRouteMiddleware(async (to, from) => {
  // 1. Never run on server
  if (import.meta.server)
    return

  console.log('[Billing Guard] to:', to.path, 'from:', from.path)

  const runtimeConfig = useRuntimeConfig()
  const failOpenFlag = runtimeConfig.public?.billingFailOpen
  const failOpen = typeof failOpenFlag === 'string'
    ? failOpenFlag.toLowerCase() === 'true'
    : Boolean(failOpenFlag)

  // 2. Get organization from route slug
  const { loggedIn, organization } = useAuth()
  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  if (!routeSlug)
    return

  console.log('[Billing Guard] routeSlug:', routeSlug)

  // Use cached org list to avoid fetching on every navigation
  const { data: orgs } = await useAsyncData('user-organizations', async () => {
    const { data } = await organization.list()
    return data
  })

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: any) => o.slug === routeSlug)
  if (!targetOrg)
    return

  const orgId = targetOrg.id
  console.log('[Billing Guard] orgId:', orgId)

  // 3. Store upgrade flag when entering billing page
  if (
    to.path.includes('/billing') &&
    to.query?.showUpgrade === 'true'
  ) {
    safeStorage.set(`org_${orgId}_needsUpgrade`, 'true')
    console.log('[Billing Guard] Stored needsUpgrade flag for org:', orgId)
    return
  }

  // 4. Check if this org needs upgrade
  const needsUpgrade = safeStorage.get(`org_${orgId}_needsUpgrade`) === 'true'
  console.log('[Billing Guard] needsUpgrade:', needsUpgrade)

  if (!needsUpgrade)
    return

  // 5. Check if route is unrestricted (billing, dashboard, home)
  const { isUnrestrictedRoute } = await import('~~/shared/utils/permissions')
  const isAllowed = isUnrestrictedRoute(to.path)
  console.log('[Billing Guard] isAllowed:', isAllowed, 'path:', to.path)

  if (isAllowed) {
    // Route is allowed even without upgrade
    return
  }

  // 6. Check subscription status
  let subs: any[] | null = []

  // Optimization: Check if activeOrg state already has the data for this org
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()

  if (activeOrg.value?.data?.id === orgId && Array.isArray((activeOrg.value.data as any).subscriptions)) {
    console.log('[Billing Guard] Using cached activeOrg subscriptions')
    subs = (activeOrg.value.data as any).subscriptions
  } else {
    const maxAttempts = 2
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        subs = await $fetch('/api/auth/subscription/list', {
          query: { referenceId: orgId },
          timeout: 10000
        })
        break
      } catch (error: any) {
        const status = error?.response?.status ?? error?.statusCode ?? error?.status
        console.error(`[Billing Guard] Subscription check failed (attempt ${attempt}/${maxAttempts}) for org ${orgId}:`, error)

        // Only throw immediately on 4xx client errors (non-retryable)
        if (status && status >= 400 && status < 500) {
          throw error
        }

        const shouldRetry = !status || status >= 500
        if (!shouldRetry || attempt === maxAttempts) {
          subs = null
        } else {
          await delay(500)
        }
      }
    }
  }

  if (subs === null) {
    const message = `[Billing Guard] Subscription lookup failed for org ${orgId}. Fail-open=${failOpen}`
    if (failOpen) {
      console.warn(message)
      return
    }

    console.error(`${message}. Blocking navigation.`)
    return navigateTo(`/${routeSlug}/billing?showUpgrade=true&reason=subscription-check-failed`)
  }

  console.log('[Billing Guard] subs:', subs)

  const hasActiveSub = Array.isArray(subs) &&
    subs.some(
      (s: any) =>
        s.status === 'active' ||
        s.status === 'trialing'
    )

  console.log('[Billing Guard] hasActiveSub:', hasActiveSub)

  if (!hasActiveSub) {
    // No Pro subscription - redirect to billing page
    console.log('[Billing Guard] REDIRECTING TO BILLING!')
    return navigateTo(`/${routeSlug}/billing?showUpgrade=true`)
  }

  // 7. If they upgraded, clear the flag
  console.log('[Billing Guard] Has subscription, clearing flag')
  safeStorage.remove(`org_${orgId}_needsUpgrade`)
})
