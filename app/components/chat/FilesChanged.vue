<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface ContentArtifact {
  id: string
  type: 'content_item'
  conversationId: string | null
  contentId: string
  data: {
    title: string
    slug: string
    status: string
    contentType: string
    currentVersion: {
      id: string
      version: number
      frontmatter: Record<string, any> | null
    } | null
  }
  createdAt: Date | string
}

interface ArtifactPagination {
  limit: number
  offset: number
  total: number
  hasMore: boolean
  nextOffset: number | null
}

interface ArtifactCacheEntry {
  artifacts: ContentArtifact[]
  pagination: ArtifactPagination
  fetchedAt: number
}

interface ArtifactResponse {
  data: ContentArtifact[]
  pagination: ArtifactPagination
}

interface Props {
  conversationId: string
}

const DEFAULT_LIMIT = 20
const CACHE_TTL_MS = 2 * 60 * 1000

const props = defineProps<Props>()
const { $fetch } = useNuxtApp()

const createEmptyPagination = (): ArtifactPagination => ({
  limit: DEFAULT_LIMIT,
  offset: 0,
  total: 0,
  hasMore: false,
  nextOffset: null
})

const artifacts = ref<ContentArtifact[]>([])
const pagination = ref<ArtifactPagination>(createEmptyPagination())
const fetchError = ref<string | null>(null)
const isFetching = ref(false)
const isLoadingMore = ref(false)
const shouldFetchOnVisible = ref(true)
const artifactsCache = useState<Map<string, ArtifactCacheEntry>>('chat/files-changed-cache', () => new Map())
const containerRef = ref<HTMLElement | null>(null)
const isVisible = import.meta.client ? useElementVisibility(containerRef) : ref(false)
let activeController: AbortController | null = null

const hasFiles = computed(() => artifacts.value.length > 0)
const isInitialLoading = computed(() => isFetching.value && artifacts.value.length === 0)

const applyCacheEntry = (entry: ArtifactCacheEntry) => {
  artifacts.value = structuredClone(entry.artifacts)
  pagination.value = { ...entry.pagination }
  fetchError.value = null
}

const cancelActiveRequest = () => {
  if (activeController) {
    activeController.abort()
    activeController = null
  }
}

const fetchArtifacts = async ({ offset = 0, append = false }: { offset?: number, append?: boolean } = {}) => {
  if (!import.meta.client || !props.conversationId) {
    return
  }

  if (!append) {
    cancelActiveRequest()
    isFetching.value = true
  } else {
    isLoadingMore.value = true
  }

  shouldFetchOnVisible.value = false
  fetchError.value = null

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  activeController = controller

  try {
    const response = await $fetch<ArtifactResponse>(`/api/conversations/${props.conversationId}/artifacts`, {
      query: { limit: DEFAULT_LIMIT, offset },
      signal: controller?.signal
    })

    const nextArtifacts = append
      ? [...artifacts.value, ...response.data]
      : response.data
    artifacts.value = nextArtifacts
    pagination.value = response.pagination

    artifactsCache.value.set(props.conversationId, {
      artifacts: structuredClone(nextArtifacts),
      pagination: { ...response.pagination },
      fetchedAt: Date.now()
    })
  } catch (error: any) {
    if (!(error?.name === 'AbortError')) {
      fetchError.value = error?.data?.statusMessage || error?.statusMessage || error?.message || 'Failed to load files'
      shouldFetchOnVisible.value = true
    }
  } finally {
    if (append) {
      isLoadingMore.value = false
    } else {
      isFetching.value = false
    }

    if (activeController === controller) {
      activeController = null
    }
  }
}

const scheduleFetchIfNeeded = () => {
  if (!import.meta.client || !props.conversationId) {
    return
  }

  if (isVisible.value && shouldFetchOnVisible.value && !isFetching.value) {
    fetchArtifacts({ offset: 0 })
  }
}

watch(() => props.conversationId, (newId) => {
  if (!import.meta.client) {
    return
  }

  cancelActiveRequest()
  artifacts.value = []
  pagination.value = createEmptyPagination()
  fetchError.value = null
  shouldFetchOnVisible.value = Boolean(newId)

  if (!newId) {
    return
  }

  const cached = artifactsCache.value.get(newId)
  if (cached) {
    applyCacheEntry(cached)
    const isStale = Date.now() - cached.fetchedAt > CACHE_TTL_MS
    shouldFetchOnVisible.value = isStale
  }

  scheduleFetchIfNeeded()
}, { immediate: true })

if (import.meta.client) {
  watch([isVisible, () => shouldFetchOnVisible.value], () => {
    scheduleFetchIfNeeded()
  })
}

const loadMore = () => {
  if (!pagination.value.hasMore || pagination.value.nextOffset == null || isLoadingMore.value) {
    return
  }
  fetchArtifacts({ offset: pagination.value.nextOffset, append: true })
}

onBeforeUnmount(() => {
  cancelActiveRequest()
})
</script>

<template>
  <div
    v-if="hasFiles || isInitialLoading || fetchError"
    ref="containerRef"
    class="space-y-2"
  >
    <div class="flex items-center gap-2 text-sm font-medium text-muted-600 dark:text-muted-400">
      <UIcon
        name="i-lucide-file-text"
        class="h-4 w-4"
      />
      <span>Files Changed</span>
      <span
        v-if="!isInitialLoading && artifacts.length"
        class="text-xs text-muted-500"
      >
        ({{ artifacts.length }})
      </span>
    </div>
    <div
      v-if="fetchError"
      class="text-sm text-red-500 dark:text-red-400"
    >
      {{ fetchError }}
    </div>
    <div
      v-if="isInitialLoading"
      class="space-y-2"
    >
      <div
        v-for="i in 2"
        :key="i"
        class="h-12 rounded bg-white/5 animate-pulse"
      />
    </div>
    <div
      v-else-if="hasFiles"
      class="space-y-1.5"
    >
      <div
        v-for="artifact in artifacts"
        :key="artifact.id"
        class="flex items-center gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <UIcon
          name="i-lucide-file-code"
          class="h-4 w-4 text-muted-500 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">
            {{ artifact.data.title || 'Untitled' }}
          </p>
          <p class="text-xs text-muted-500 truncate">
            {{ artifact.data.slug }}.{{ artifact.data.contentType ? artifact.data.contentType.split('/')[1] || 'mdx' : 'mdx' }}
          </p>
        </div>
        <UBadge
          v-if="artifact.data.status"
          :color="artifact.data.status === 'published' ? 'success' : 'neutral'"
          variant="soft"
          size="xs"
        >
          {{ artifact.data.status }}
        </UBadge>
      </div>
      <div
        v-if="pagination.hasMore"
        class="pt-1"
      >
        <UButton
          variant="soft"
          size="xs"
          :loading="isLoadingMore"
          @click="loadMore"
        >
          Load more files
        </UButton>
      </div>
    </div>
  </div>
</template>
