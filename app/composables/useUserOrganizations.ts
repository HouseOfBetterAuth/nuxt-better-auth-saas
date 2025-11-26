interface UserOrganization {
  id: string
  slug: string
  [key: string]: any
}

const USER_ORGANIZATIONS_KEY = 'user-organizations'

export function useUserOrganizations(options?: { lazy?: boolean }) {
  const { organization } = useAuth()

  const fetchOrganizations = async () => {
    const { data } = await organization.list()
    return data as UserOrganization[]
  }

  return useAsyncData<UserOrganization[]>(USER_ORGANIZATIONS_KEY, fetchOrganizations, {
    lazy: options?.lazy
  })
}
