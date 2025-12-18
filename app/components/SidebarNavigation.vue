<script setup lang="ts">
import { useContentList } from '~/composables/useContentList'

const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

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

const initializeContent = async () => {
  try {
    await loadContentInitial()
  } catch {
    // Errors are surfaced via UI alert; swallow here to avoid console noise
  }
}

onMounted(() => {
  initializeContent()
})

// Active content/conversation detection
const activeContentId = computed(() => {
  const path = route.path
  // Check for /[slug]/content pattern
  if (/\/[^/]+\/content\//.test(path)) {
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

const resolveContentPath = (contentId?: string | null) => {
  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === 't')
    return null
  const base = `/${slug}/content`
  return contentId ? `${base}/${contentId}` : base
}

const openContent = (contentId: string | null) => {
  const path = resolveContentPath(contentId || undefined)
  if (path)
    router.push(localePath(path))
}
</script>

<template>
  <div class="space-y-6">
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
  </div>
</template>
