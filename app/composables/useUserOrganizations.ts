interface UserOrganization {
  id: string
  slug: string
  name?: string
  [key: string]: any
}

const USER_ORGANIZATIONS_KEY = 'user-organizations'

/**
 * Shared composable for fetching user organizations with proper caching.
 * This is the single source of truth to avoid duplicate fetches.
 * Caching is enabled by default to improve performance.
 */
export function useUserOrganizations(options?: { lazy?: boolean }) {
  const { organization, user } = useAuth()

  const userId = computed(() => user.value?.id || 'anon')
  const cacheKey = computed(() => `${USER_ORGANIZATIONS_KEY}:${userId.value}`)

  const fetchOrganizations = async () => {
    try {
      const { data } = await organization.list()
      if (!Array.isArray(data)) {
        console.warn('[useUserOrganizations] Unexpected response shape', data)
        throw new Error('Organization list response is not an array')
      }
      const sanitized = data.filter((org: any): org is UserOrganization =>
        typeof org?.id === 'string' &&
        typeof org?.slug === 'string' &&
        !org.slug.startsWith('anonymous-')
      )
      if (sanitized.length !== data.length) {
        console.warn('Filtered organizations due to missing id/slug or anonymous slug', { total: data.length, sanitized: sanitized.length })
      }
      return sanitized
    } catch (error) {
      console.error('[useUserOrganizations] Failed to fetch organizations', error)
      if (error instanceof Error)
        throw error
      throw new Error('Failed to fetch organizations')
    }
  }

  // Enable proper caching - remove getCachedData: () => undefined to allow Nuxt to cache
  return useAsyncData<UserOrganization[]>(() => cacheKey.value, fetchOrganizations, {
    lazy: options?.lazy,
    watch: [userId]
    // Caching is enabled by default - Nuxt will cache based on the key
  })
}
