interface UserOrganization {
  id: string
  slug: string
  [key: string]: any
}

const USER_ORGANIZATIONS_KEY = 'user-organizations'

export function useUserOrganizations(options?: { lazy?: boolean }) {
  const { organization, user } = useAuth()

  const userId = user.value?.id || 'anon'
  const cacheKey = `${USER_ORGANIZATIONS_KEY}:${userId}`

  const fetchOrganizations = async () => {
    try {
      const { data } = await organization.list()
      if (!Array.isArray(data)) {
        console.warn('[useUserOrganizations] Unexpected response shape', data)
        return []
      }
      return data.filter((org: any): org is UserOrganization => typeof org?.id === 'string' && typeof org?.slug === 'string')
    } catch (error) {
      console.error('[useUserOrganizations] Failed to fetch organizations', error)
      return []
    }
  }

  return useAsyncData<UserOrganization[]>(cacheKey, fetchOrganizations, {
    lazy: options?.lazy
  })
}
