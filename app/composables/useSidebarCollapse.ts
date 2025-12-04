import { readonly } from 'vue'

export const useSidebarCollapse = () => {
  const isCollapsed = useState('sidebar-collapsed', () => false)

  const toggle = () => {
    isCollapsed.value = !isCollapsed.value
  }

  return {
    isCollapsed: readonly(isCollapsed),
    toggle
  }
}
