interface SimpleOrganization {
  id: string
  slug: string
  [key: string]: any
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  const _nuxtApp = useNuxtApp()
  const toast = import.meta.client ? useToast() : null

  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  if (!routeSlug || routeSlug === 't')
    return

  // Don't run on non-dashboard routes if they happen to have a slug param but aren't organization related
  // Assuming all routes with :slug are organization routes based on app structure

  // Check if we need to switch organization
  const activeOrgId = (session.value as any)?.activeOrganizationId

  // Use cached org list to avoid fetching on every navigation
  const { data: orgs, error: orgsError } = await useUserOrganizations()

  if (orgsError.value) {
    if (import.meta.client) {
      toast?.add({
        title: 'Organization sync failed',
        description: 'Unable to load your organizations. Please retry.',
        color: 'error'
      })
    }
    return
  }

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: SimpleOrganization) => o.slug === routeSlug)

  if (targetOrg) {
    if (targetOrg.id !== activeOrgId) {
      try {
        await organization.setActive({ organizationId: targetOrg.id })
        await fetchSession()
        const activeOrg = useActiveOrganization()
        if (activeOrg.value) {
          activeOrg.value.data = targetOrg
        }
      } catch (error) {
        console.error('[Organization Guard] Failed to set active organization', error)
        toast?.add({
          title: 'Unable to switch organization',
          description: 'Please try again or refresh the page.',
          color: 'error'
        })
      }
    }
  } else {
    // Invalid slug, redirect to first available org or handle error
    // We can redirect to the first org's dashboard if the user has access to any orgs
    const firstOrg = orgs.value?.[0]
    if (firstOrg) {
      // Prevent infinite redirect if we are already redirected
      const localePath = useLocalePath()
      const targetPath = localePath(`/${firstOrg.slug}/dashboard`)
      if (to.path !== targetPath) {
        toast?.add({
          title: 'Organization unavailable',
          description: 'Navigated to your first available team.',
          color: 'warning'
        })
        return navigateTo(targetPath, { replace: true })
      }
    }
  }
})
