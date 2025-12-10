import { useUserOrganizations } from '~/composables/useUserOrganizations'

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  if (!routeSlug || routeSlug === 't')
    return

  // Only handle routes that still use slug-based routing (settings, billing, etc.)
  // New routes (/conversations, /content) don't use slugs, so this middleware won't run for them

  // Check if we need to switch organization
  const activeOrgId = (session.value as any)?.activeOrganizationId

  // Use shared composable with proper caching enabled
  const { data: orgs, pending } = useUserOrganizations()

  // Wait for organizations to load
  if (pending.value) {
    return
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
