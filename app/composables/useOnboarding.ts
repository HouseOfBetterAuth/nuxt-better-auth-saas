interface OnboardingModalState {
  isOpen: boolean
}

export function useOnboarding() {
  const modalState = useState<OnboardingModalState>('onboarding-modal-state', () => ({
    isOpen: false
  }))

  // Call composables synchronously at top-level to avoid "Nuxt instance is unavailable"
  // when invoked from within async callbacks.
  const { organization } = useAuth()

  const organizationsQuery = useAsyncData('user-organizations', async () => {
    const { data, error } = await organization.list()
    if (error) {
      console.error('[useOnboarding] Failed to load organizations', error)
      return []
    }
    return data
  }, {
    server: false,
    getCachedData: () => undefined
  })

  const organizations = computed(() => organizationsQuery.data.value ?? null)

  const pendingOrganizations = computed(() => organizationsQuery.pending.value)

  const isOpen = computed({
    get: () => modalState.value.isOpen,
    set: (value: boolean) => {
      modalState.value.isOpen = value
    }
  })

  const showOnboarding = async () => {
    modalState.value.isOpen = true
  }

  const hideOnboarding = () => {
    modalState.value.isOpen = false
  }

  const refreshOrganizations = async () => {
    await organizationsQuery.refresh()
  }

  return {
    isOnboardingOpen: isOpen,
    showOnboarding,
    hideOnboarding,
    refreshOrganizations,
    organizations,
    pendingOrganizations
  }
}
