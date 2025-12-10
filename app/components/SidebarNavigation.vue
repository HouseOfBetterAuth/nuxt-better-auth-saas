<script setup lang="ts">
const route = useRoute()
const { loggedIn } = useAuth()

// Get conversation menu items from shared state (set by QuillioWidget)
const conversationMenuItems = useState<any[][]>('conversation-menu-items', () => [])

// Fetch content list (only for logged in users)
const { data: contentData } = await useFetch('/api/content', {
  default: () => [],
  lazy: true,
  server: false
})

// Transform content to menu items format
const contentMenuItems = computed(() => {
  if (!loggedIn.value || !contentData.value || !Array.isArray(contentData.value)) {
    return []
  }

  const items = contentData.value.map((row: any) => {
    const content = row.content
    if (!content) return null

    return {
      label: content.title || 'Untitled',
      to: `/content/${content.id}`,
      badge: content.status || undefined
    }
  }).filter(Boolean)

  return items.length > 0 ? [items] : []
})

// Build navigation menu items using NuxtUI format (array of arrays for groups)
const navigationMenuItems = computed(() => {
  const items: any[][] = []

  // Conversations section
  const conversationsHeader = {
    label: 'Conversations',
    icon: 'i-lucide-message-circle',
    to: '/conversations',
    disabled: false
  }
  const conversationsList = conversationMenuItems.value[0] || []
  items.push([conversationsHeader, ...conversationsList])

  // Content section (only for logged in users)
  if (loggedIn.value) {
    const contentHeader = {
      label: 'Content',
      icon: 'i-lucide-file-text',
      to: '/content',
      disabled: false
    }
    const contentList = contentMenuItems.value[0] || []
    items.push([contentHeader, ...contentList])
  }

  return items
})
</script>

<template>
  <UNavigationMenu
    :items="navigationMenuItems"
    orientation="vertical"
  />
</template>
