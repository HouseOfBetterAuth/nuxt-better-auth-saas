import { useLocalStorage } from '@vueuse/core'
import { readonly } from 'vue'

export const useSidebarCollapse = () => {
  // Persist sidebar collapse state using useLocalStorage (SSR-safe, Cloudflare-compatible)
  const isCollapsed = useLocalStorage('sidebar-collapsed', false)

  const toggle = () => {
    isCollapsed.value = !isCollapsed.value
  }

  return {
    isCollapsed: readonly(isCollapsed),
    toggle
  }
}
