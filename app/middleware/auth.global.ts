import { defu } from 'defu'

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

  // If not authenticated, redirect to home
  if (!loggedIn.value) {
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
