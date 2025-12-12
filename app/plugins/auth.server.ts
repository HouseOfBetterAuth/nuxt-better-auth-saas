import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { fetchActiveOrgExtrasForUser, fetchFullOrganizationForSSR } from '~~/server/utils/organization'
import { createEmptyActiveOrgExtras } from '~~/shared/utils/organizationExtras'
import { AUTH_USER_DEFAULTS } from '~/composables/useAuth'

export default defineNuxtPlugin({
  name: 'better-auth-ssr-hydration',
  enforce: 'pre',
  async setup(nuxtApp) {
    const event = useRequestEvent()
    nuxtApp.payload.isCached = Boolean(event?.context.cache)

    if (!event || !nuxtApp.payload.serverRendered || nuxtApp.payload.prerenderedAt || nuxtApp.payload.isCached) {
      return
    }

    const [sessionState, userState, activeOrgState, activeOrgExtrasState] = [
      useState('auth:session', () => null),
      useState('auth:user', () => null),
      useState('auth:active-organization:data', () => null),
      useState('active-org-extras', () => createEmptyActiveOrgExtras())
    ]

    const authSession = await getAuthSession(event)
    event.context.authSession = authSession

    sessionState.value = authSession?.session ?? null
    userState.value = authSession?.user
      ? Object.assign({}, AUTH_USER_DEFAULTS, authSession.user)
      : null

    const activeOrganizationId = (authSession?.session as any)?.activeOrganizationId

    if (activeOrganizationId) {
      let fullOrganization = await fetchFullOrganizationForSSR(activeOrganizationId)
      if (!fullOrganization) {
        const db = getDB()
        const [organization] = await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, activeOrganizationId))
          .limit(1)
        fullOrganization = organization ? { data: organization } : null
      }
      activeOrgState.value = fullOrganization

      if (authSession?.user?.id) {
        activeOrgExtrasState.value = await fetchActiveOrgExtrasForUser(authSession.user.id, activeOrganizationId)
      } else {
        activeOrgExtrasState.value = createEmptyActiveOrgExtras()
      }
    } else {
      activeOrgState.value = null
      activeOrgExtrasState.value = createEmptyActiveOrgExtras()
    }
  }
})
