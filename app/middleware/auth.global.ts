import { defu } from 'defu'
import { isAnonymousWorkspaceConversationRoute } from '~~/shared/utils/routeMatching'

// Known locale codes from nuxt.config.ts (keep in sync with `organization.global.ts`)
const KNOWN_LOCALES = ['en', 'zh-CN', 'ja', 'fr']

type MiddlewareOptions = false | {
  /**
   * Only apply auth middleware to guest or user
   */
  only?: 'guest' | 'user'
  /**
   * Redirect authenticated user to this route
   */
  redirectUserTo?: string
  /**
   * Redirect guest to this route
   */
  redirectGuestTo?: string
}

declare module '#app' {
  interface PageMeta {
    auth?: MiddlewareOptions
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    auth?: MiddlewareOptions
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  // Exclude API documentation routes from auth
  if (to.path.startsWith('/api-reference') || to.path.startsWith('/docs') || to.path.startsWith('/_nitro/openapi')) {
    return
  }

  // If auth is disabled, skip middleware
  if (to.meta?.auth === false) {
    return
  }
  const { loggedIn, user, fetchSession } = useAuth()
  const redirectOptions = useRuntimeConfig().public.auth
  const { only, redirectUserTo, redirectGuestTo } = defu(to.meta?.auth, redirectOptions)

  await fetchSession()

  const localePath = useLocalePath()

  if (only === 'guest') {
    if (loggedIn.value) {
      // Guest-only routes: redirect authenticated users to specified path
      // Avoid infinite redirect
      if (to.path === localePath(redirectUserTo)) {
        return
      }
      return navigateTo(localePath(redirectUserTo))
    } else {
      // Allow guest access to this route
      return
    }
  }

  // If not authenticated, check if route allows anonymous access
  // Allow root route and *anonymous* slug-based conversation routes
  const isAnonymousAllowedRoute = (() => {
    const path = to.path
    // Allow root route
    if (path === '/' || path === localePath('/'))
      return true
    // Allow only anonymous workspace conversation routes: /anonymous-*/conversations
    // Strip locale prefix (if present) before extracting the workspace slug.
    if (isAnonymousWorkspaceConversationRoute(path, KNOWN_LOCALES))
      return true
    return false
  })()

  if (!loggedIn.value) {
    if (isAnonymousAllowedRoute) {
      return
    }
    // Avoid infinite redirect
    if (to.path === localePath(redirectGuestTo)) {
      return
    }
    return navigateTo(localePath(`${redirectGuestTo}?redirect=${to.fullPath}`))
  }

  // Admin Pages
  const routeBaseName = useRouteBaseName()
  const routeName = routeBaseName(to)
  if (routeName?.startsWith('admin') && user.value?.role != 'admin') {
    return navigateTo(localePath('/403'))
  }
  if (routeName == 'admin') {
    return navigateTo(localePath('/admin/dashboard'))
  }
})
