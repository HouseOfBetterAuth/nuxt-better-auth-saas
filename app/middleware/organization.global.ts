import { useUserOrganizations } from '~/composables/useUserOrganizations'

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  if (!loggedIn.value)
    return

  let routeSlug = to.params.slug as string | undefined
  if (!routeSlug || routeSlug === 't') {
    const contentMatch = to.path.match(/^\/([^/]+)\/content(?:\/|$)/)
    if (contentMatch && contentMatch[1] && contentMatch[1] !== 't') {
      routeSlug = contentMatch[1]
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
  while (pending.value) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }

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
