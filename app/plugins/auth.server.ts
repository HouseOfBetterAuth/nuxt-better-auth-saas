import { getAuthSession } from '~~/server/utils/auth'
import { fetchActiveOrgExtrasForUser, fetchFullOrganizationForSSR } from '~~/server/utils/organization'
import { createEmptyActiveOrgExtras } from '~~/shared/utils/organizationExtras'
import { AUTH_USER_DEFAULTS } from '~/composables/useAuth'

export default defineNuxtPlugin({
  name: 'better-auth-ssr-hydration',
  enforce: 'pre',
  async setup(nuxtApp) {
    const event = useRequestEvent()
    nuxtApp.payload.isCached = Boolean(event?.context.cache)

    const [sessionState, userState, activeOrgState, activeOrgExtrasState] = [
      useState('auth:session', () => null),
      useState('auth:user', () => null),
      useState('auth:active-organization:data', () => null),
      useState('active-org-extras', () => createEmptyActiveOrgExtras())
    ]

    if (!event || !nuxtApp.payload.serverRendered || nuxtApp.payload.prerenderedAt || nuxtApp.payload.isCached) {
      return
    }

    const authSession = await getAuthSession(event)
    event.context.authSession = authSession

    sessionState.value = authSession?.session ?? null
    userState.value = authSession?.user
      ? Object.assign({}, AUTH_USER_DEFAULTS, authSession.user)
      : null

    const activeOrganizationId = (authSession?.session as any)?.activeOrganizationId

    const resetOrgState = () => {
      activeOrgState.value = null
      activeOrgExtrasState.value = createEmptyActiveOrgExtras()
    }

    if (!activeOrganizationId) {
      resetOrgState()
      return
    }

    if (!authSession?.user?.id) {
      resetOrgState()
      return
    }

    try {
      const activeOrgExtras = await fetchActiveOrgExtrasForUser(authSession.user.id, activeOrganizationId)
      activeOrgExtrasState.value = activeOrgExtras
    } catch (error) {
      console.debug('[better-auth-ssr-hydration] Failed to verify organization membership', error)
      resetOrgState()
      return
    }

    const fullOrganization = await fetchFullOrganizationForSSR(activeOrganizationId)
    if (fullOrganization) {
      activeOrgState.value = fullOrganization
    } else {
      resetOrgState()
    }
  }
})
