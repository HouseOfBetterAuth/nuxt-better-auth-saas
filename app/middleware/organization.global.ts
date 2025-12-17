import { watch } from 'vue'
import { useUserOrganizations } from '~/composables/useUserOrganizations'

// Known locale codes from nuxt.config.ts
const KNOWN_LOCALES = ['en', 'zh-CN', 'ja', 'fr']

type PendingWaitResult = { ok: true } | { ok: false, reason: 'timeout' }

async function waitForPendingToResolve(
  pending: { value: boolean },
  { timeoutMs = 3000 }: { timeoutMs?: number } = {}
): Promise<PendingWaitResult> {
  if (!pending.value) {
    return { ok: true }
  }

  return await new Promise((resolve) => {
    let done = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const stop = watch(
      () => pending.value,
      (isPending) => {
        if (done)
          return
        if (!isPending) {
          done = true
          stop()
          if (timeoutId)
            clearTimeout(timeoutId)
          resolve({ ok: true })
        }
      },
      { immediate: true }
    )

    timeoutId = setTimeout(() => {
      if (done)
        return
      done = true
      stop()
      resolve({ ok: false, reason: 'timeout' })
    }, timeoutMs)
  })
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  if (!loggedIn.value)
    return

  // If a user hits home (`/`) while logged in, send them into their org-scoped workspace.
  // This keeps `/` as the anonymous/landing experience without changing the default layout.
  const localePath = useLocalePath()
  if (to.path === '/' || to.path === localePath('/')) {
    const activeOrg = useActiveOrganization()
    const slug = activeOrg.value?.data?.slug
    if (slug && slug !== 't') {
      return navigateTo(localePath(`/${slug}/conversations`))
    }
    // Fall back to first available org if active org isn't loaded yet.
    const { data: orgs, pending } = useUserOrganizations()
    await waitForPendingToResolve(pending, { timeoutMs: 3000 })
    const firstOrg = orgs.value?.[0]
    if (firstOrg?.slug) {
      return navigateTo(localePath(`/${firstOrg.slug}/conversations`))
    }
  }

  let routeSlug = to.params.slug as string | undefined
  if (!routeSlug || routeSlug === 't') {
    // Get current locale from route params or check first path segment
    // In Nuxt i18n, the locale might be in to.params.locale or as the first path segment
    const routeLocale = (to.params.locale as string | undefined) ||
      (to.path.split('/').filter(Boolean)[0] as string | undefined)

    // Check if first path segment is a known locale code
    const currentLocale = routeLocale && KNOWN_LOCALES.includes(routeLocale) ? routeLocale : null
    let pathToCheck = to.path

    // Remove locale prefix if it matches the first segment
    if (currentLocale) {
      const pathSegments = pathToCheck.split('/').filter(Boolean)
      if (pathSegments.length > 0 && pathSegments[0] === currentLocale) {
        pathSegments.shift()
        pathToCheck = `/${pathSegments.join('/')}`
      }
    }

    const contentMatch = pathToCheck.match(/^\/([^/]+)\/content(?:\/|$)/)
    if (contentMatch && contentMatch[1] && contentMatch[1] !== 't') {
      routeSlug = contentMatch[1]
    }

    const conversationsMatch = pathToCheck.match(/^\/([^/]+)\/conversations(?:\/|$)/)
    if (conversationsMatch && conversationsMatch[1] && conversationsMatch[1] !== 't') {
      routeSlug = conversationsMatch[1]
    }
  }
  if (!routeSlug || routeSlug === 't')
    return

  // Only handle routes that use slug-based routing (settings, billing, content, etc.)

  // Check if we need to switch organization
  interface SessionWithOrg {
    activeOrganizationId?: string | null
  }
  const activeOrgId = (session.value as unknown as SessionWithOrg)?.activeOrganizationId

  // Use shared composable with proper caching enabled
  const { data: orgs, pending } = useUserOrganizations()

  // Wait for organizations to load
  await waitForPendingToResolve(pending, { timeoutMs: 3000 })

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: any) => o.slug === routeSlug)

  if (targetOrg) {
    if (targetOrg.id !== activeOrgId) {
      // Organization mismatch, set active organization
      await organization.setActive({ organizationId: targetOrg.id })
      await fetchSession()

      // Update activeOrg ref immediately to update UI
      const activeOrg = useActiveOrganization()
      if (activeOrg.value) {
        activeOrg.value.data = targetOrg
      }
    }
  } else {
    // Invalid slug, redirect to first available org or handle error
    const firstOrg = orgs.value?.[0]
    if (firstOrg) {
      // Prevent infinite redirect if we are already redirected
      const localePath = useLocalePath()
      const targetPath = localePath(`/${firstOrg.slug}/members`)
      if (to.path !== targetPath) {
        return navigateTo(targetPath)
      }
    }
  }
})
