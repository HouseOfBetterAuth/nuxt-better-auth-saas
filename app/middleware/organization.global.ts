export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  if (!routeSlug || routeSlug === 't')
    return

  // Only run on organization-scoped routes (Nuxt pages under `app/pages/[slug]/...`).
  // This avoids accidentally running on other routes that might also have a `slug` param.
  const isOrganizationRoute = to.matched.some(record =>
    record.path === '/:slug'
    || record.path.startsWith('/:slug/')
  )
  if (!isOrganizationRoute)
    return

  // Check if we need to switch organization
  const activeOrgId = (session.value as any)?.activeOrganizationId

  // Use cached org list to avoid fetching on every navigation
  const { data: orgs } = await useAsyncData('user-organizations', async () => {
    const { data } = await organization.list()
    return data
  }, {
    // Ensure fresh data on each full page load (but still cache per navigation)
    getCachedData: () => undefined
  })

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
    // Redirect to an org landing page if the user has access to any orgs
    const firstOrg = orgs.value?.[0]
    if (firstOrg) {
      // Prevent infinite redirect if we are already redirected
      const localePath = useLocalePath()
      const targetPath = localePath(`/${firstOrg.slug}/conversations`)
      if (to.path !== targetPath) {
        return navigateTo(targetPath)
      }
    }
  }
})
