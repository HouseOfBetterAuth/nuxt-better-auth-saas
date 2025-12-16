import { getAuthSession } from '~~/server/utils/auth'
import { AUTH_USER_DEFAULTS } from '~/composables/useAuth'

export default defineNuxtPlugin({
  name: 'better-auth-ssr-hydration',
  enforce: 'pre',
  async setup(nuxtApp) {
    const event = useRequestEvent()
    nuxtApp.payload.isCached = Boolean(event?.context.cache)

    const [sessionState, userState, activeOrgState] = [
      useState('auth:session', () => null),
      useState('auth:user', () => null),
      useState('auth:active-organization:data', () => null)
    ]

    if (!event || !nuxtApp.payload.serverRendered || nuxtApp.payload.prerenderedAt || nuxtApp.payload.isCached) {
      return
    }

    let authSession = null
    try {
      authSession = await getAuthSession(event)
    } catch (error) {
      console.debug('[better-auth-ssr-hydration] Failed to load auth session', error)
    }
    event.context.authSession = authSession

    sessionState.value = authSession?.session ?? null
    userState.value = authSession?.user
      ? Object.assign({}, AUTH_USER_DEFAULTS, authSession.user)
      : null

    activeOrgState.value = null
  }
})
