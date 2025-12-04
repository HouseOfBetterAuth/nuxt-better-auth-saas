import type { AsyncData } from 'nuxt/app'

interface OnboardingModalState {
  isOpen: boolean
}

export function useOnboarding() {
  const { loggedIn } = useAuth()

  const modalState = useState<OnboardingModalState>('onboarding-modal-state', () => ({
    isOpen: false
  }))

  const organizationsQuery = useUserOrganizations()

  const organizations = computed(() => organizationsQuery.data.value ?? null)

  const pendingOrganizations = computed(() => organizationsQuery.pending.value)

  const needsOnboarding = computed(() => {
    if (!loggedIn.value)
      return false
    if (pendingOrganizations.value)
      return false
    if (!organizations.value)
      return false
    return organizations.value.length === 0
  })

  const isOpen = computed({
    get: () => modalState.value.isOpen,
    set: (value: boolean) => {
      modalState.value.isOpen = value
    }
  })

  const showOnboarding = () => {
    modalState.value.isOpen = true
  }

  const hideOnboarding = () => {
    modalState.value.isOpen = false
  }

  const refreshOrganizations: AsyncData<any, any>['refresh'] = async () => {
    await organizationsQuery.refresh()
  }

  return {
    isOnboardingOpen: isOpen,
    showOnboarding,
    hideOnboarding,
    needsOnboarding,
    refreshOrganizations,
    organizations,
    pendingOrganizations
  }
}
