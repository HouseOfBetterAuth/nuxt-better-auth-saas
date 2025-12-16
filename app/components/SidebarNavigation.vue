<script setup lang="ts">
import { useContentList } from '~/composables/useContentList'
import { useConversationList } from '~/composables/useConversationList'

const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()

// Content list
const {
  items: contentItems,
  pending: contentPending,
  error: contentError,
  hasMore: contentHasMore,
  initialized: contentInitialized,
  loadInitial: loadContentInitial,
  loadMore: loadContentMore,
  remove: _removeContent,
  refresh: _refreshContent
} = useContentList({ pageSize: 40 })

// Conversation list
const {
  items: conversationItems,
  pending: conversationPending,
  error: conversationError,
  hasMore: conversationHasMore,
  initialized: conversationInitialized,
  loadInitial: loadConversationInitial,
  loadMore: loadConversationMore,
  remove: removeConversation,
  refresh: refreshConversation
} = useConversationList({ pageSize: 40 })

const initializeContent = async () => {
  try {
    await loadContentInitial()
  } catch {
    // Errors are surfaced via UI alert; swallow here to avoid console noise
  }
}

const initializeConversations = async () => {
  try {
    await loadConversationInitial()
  } catch {
    // Errors are surfaced via UI alert; swallow here to avoid console noise
  }
}

onMounted(() => {
  initializeContent()
  initializeConversations()
})

const normalizePathForMatch = (value: string) => {
  if (!value)
    return ''
  if (value === '/')
    return '/'
  return value.endsWith('/') ? value : `${value}/`
}

const ensureLeadingSlash = (value: string) => value.startsWith('/') ? value : `/${value}`

const buildCandidates = (pattern: string) => {
  const normalizedPattern = ensureLeadingSlash(pattern)
  const candidates = new Set<string>()
  const localizedPattern = localePath(normalizedPattern)

  candidates.add(normalizePathForMatch(normalizedPattern))
  if (localizedPattern)
    candidates.add(normalizePathForMatch(localizedPattern))

  return Array.from(candidates).filter(Boolean)
}

const isRouteMatch = (pattern: string) => {
  const currentPath = normalizePathForMatch(route.path)
  const candidates = buildCandidates(pattern)
  return candidates.some(candidate => currentPath.startsWith(candidate))
}

// Active content/conversation detection
const activeContentId = computed(() => {
  if (isRouteMatch('/content/')) {
    const id = route.params.id
    if (Array.isArray(id))
      return id[0] || null
    return id || null
  }
  return null
})

const activeConversationId = computed(() => {
  if (isRouteMatch('/conversations/')) {
    const id = route.params.id
    if (Array.isArray(id))
      return id[0] || null
    return id || null
  }
  return null
})

const isContentActive = (id: string) => {
  return activeContentId.value === id
}

const isConversationActive = (id: string) => {
  return activeConversationId.value === id
}

const resolveContentPath = (contentId?: string | null) => {
  const base = '/content'
  return contentId ? `${base}/${contentId}` : base
}

const openContent = (contentId: string | null) => {
  router.push(localePath(resolveContentPath(contentId || undefined)))
}

const openConversation = (conversationId: string | null) => {
  if (conversationId) {
    router.push(localePath(`/conversations/${conversationId}`))
  } else {
    router.push(localePath('/conversations'))
  }
}

const createConversation = () => {
  router.push({
    path: localePath('/conversations'),
    query: { new: '1' }
  })
}

const archivingConversationId = ref<string | null>(null)

const archiveConversation = async (conversationId: string, event?: Event) => {
  if (event) {
    event.stopPropagation()
  }

  if (!conversationId || archivingConversationId.value === conversationId)
    return

  archivingConversationId.value = conversationId
  try {
    await $fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' })
    removeConversation(conversationId)

    if (activeConversationId.value === conversationId) {
      router.push(localePath('/conversations'))
    }

    await refreshConversation().catch(() => {})
    toast.add({
      title: 'Conversation archived',
      description: 'The conversation has been moved to your archive.',
      icon: 'i-lucide-archive',
      color: 'neutral'
    })
  } catch (error: any) {
    console.error('Failed to archive conversation', error)
    toast.add({
      title: 'Failed to archive',
      description: error?.data?.statusMessage || error?.message || 'Unable to archive this conversation.',
      color: 'error'
    })
  } finally {
    archivingConversationId.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Content Section -->
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          Content
        </p>
      </div>

      <div class="space-y-1">
        <template v-if="contentInitialized && contentItems.length > 0">
          <div
            v-for="content in contentItems"
            :key="content.id"
            class="group relative w-full rounded-md border border-transparent transition-colors"
            :class="isContentActive(content.id)
              ? 'bg-neutral-100/80 dark:bg-neutral-800/60'
              : 'hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40'"
          >
            <button
              type="button"
              class="w-full text-left rounded-md px-3 py-2"
              @click="openContent(content.id)"
            >
              <p class="text-sm font-medium truncate pr-8">
                {{ content.displayLabel }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ content.updatedAgo }}
              </p>
            </button>
          </div>
        </template>

        <template v-else-if="!contentInitialized">
          <div
            v-for="n in 5"
            :key="n"
            class="rounded-md border border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2"
          >
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-3 w-1/2 mt-2" />
          </div>
        </template>

        <p
          v-else-if="contentInitialized && contentItems.length === 0"
          class="text-sm text-muted-foreground py-3"
        >
          No content yet.
        </p>
      </div>

      <UAlert
        v-if="contentError"
        color="error"
        variant="soft"
        :title="contentError"
      />

      <div class="pt-2">
        <UButton
          v-if="contentHasMore"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="contentPending"
          @click="loadContentMore()"
        >
          Load more
        </UButton>
      </div>
    </section>

    <!-- Conversations Section -->
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          Conversations
        </p>
        <UButton
          icon="i-lucide-plus"
          size="2xs"
          color="neutral"
          variant="ghost"
          aria-label="New conversation"
          @click="createConversation"
        />
      </div>

      <div class="space-y-1">
        <template v-if="conversationInitialized && conversationItems.length > 0">
          <div
            v-for="conversation in conversationItems"
            :key="conversation.id"
            class="group relative w-full rounded-md border border-transparent transition-colors"
            :class="isConversationActive(conversation.id)
              ? 'bg-neutral-100/80 dark:bg-neutral-800/60'
              : 'hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40'"
          >
            <button
              type="button"
              class="w-full text-left rounded-md px-3 py-2"
              @click="openConversation(conversation.id)"
            >
              <p class="text-sm font-medium truncate pr-8">
                {{ conversation.displayLabel }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ conversation.updatedAgo }}
              </p>
            </button>
            <UButton
              icon="i-lucide-archive"
              size="2xs"
              color="neutral"
              variant="ghost"
              :loading="archivingConversationId === conversation.id"
              :disabled="archivingConversationId === conversation.id"
              class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Archive conversation"
              @click="archiveConversation(conversation.id, $event)"
            />
          </div>
        </template>

        <template v-else-if="!conversationInitialized">
          <div
            v-for="n in 5"
            :key="n"
            class="rounded-md border border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2"
          >
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-3 w-1/2 mt-2" />
          </div>
        </template>

        <p
          v-else-if="conversationInitialized && conversationItems.length === 0"
          class="text-sm text-muted-foreground py-3"
        >
          No conversations yet.
        </p>
      </div>

      <UAlert
        v-if="conversationError"
        color="error"
        variant="soft"
        :title="conversationError"
      />

      <div class="pt-2">
        <UButton
          v-if="conversationHasMore"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="conversationPending"
          @click="loadConversationMore()"
        >
          Load more
        </UButton>
      </div>
    </section>
  </div>
</template>
