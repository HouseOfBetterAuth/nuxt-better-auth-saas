import { computed } from 'vue'

export interface ContentListItem {
  id: string
  displayLabel: string
  updatedAgo: string
}

interface FetchResponse {
  contents: ContentListItem[]
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

const DEFAULT_PAGE_SIZE = 30

export function useContentList(options?: { pageSize?: number, stateKey?: string }) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const baseKey = options?.stateKey ?? `default:${pageSize}`
  const resolveKey = (segment: string) => `content-list:${baseKey}:${segment}`

  const itemsState = useState<ContentListItem[]>(resolveKey('items'), () => [])
  const cursorState = useState<string | null>(resolveKey('cursor'), () => null)
  const hasMoreState = useState<boolean>(resolveKey('has-more'), () => true)
  const pendingState = useState<boolean>(resolveKey('pending'), () => false)
  const errorState = useState<string | null>(resolveKey('error'), () => null)
  const initializedState = useState<boolean>(resolveKey('initialized'), () => false)

  const mergeItems = (incoming: ContentListItem[], replace = false) => {
    if (replace) {
      itemsState.value = [...incoming]
      return
    }
    const next = [...itemsState.value]
    for (const entry of incoming) {
      const existingIndex = next.findIndex(item => item.id === entry.id)
      if (existingIndex !== -1) {
        next.splice(existingIndex, 1)
      }
      next.push(entry)
    }
    itemsState.value = next
  }

  const fetchPage = async (opts?: { cursor?: string | null, replace?: boolean }) => {
    if (pendingState.value)
      return

    pendingState.value = true
    errorState.value = null
    try {
      const response = await $fetch<FetchResponse>('/api/content', {
        query: {
          limit: pageSize,
          cursor: opts?.cursor ?? undefined
        }
      })

      const records = response?.contents ?? []
      mergeItems(records, Boolean(opts?.replace || !opts?.cursor))
      cursorState.value = response?.nextCursor ?? null
      hasMoreState.value = Boolean(response?.hasMore && response.nextCursor)
      initializedState.value = true
    } catch (error) {
      console.error('[content-list] failed to fetch', error)
      errorState.value = error instanceof Error ? error.message : 'Failed to load content'
      throw error
    } finally {
      pendingState.value = false
    }
  }

  const loadInitial = async () => {
    if (initializedState.value)
      return
    await fetchPage({ replace: true })
  }

  const refresh = async () => {
    await fetchPage({ replace: true })
  }

  const loadMore = async () => {
    if (!hasMoreState.value || !cursorState.value)
      return
    await fetchPage({ cursor: cursorState.value })
  }

  const upsert = (entry: ContentListItem) => {
    const normalized: ContentListItem = {
      id: entry.id,
      displayLabel: entry.displayLabel || 'Untitled content',
      updatedAgo: entry.updatedAgo || 'Just now'
    }
    const next = itemsState.value.filter(item => item.id !== normalized.id)
    itemsState.value = [normalized, ...next]
  }

  const remove = (contentId: string) => {
    itemsState.value = itemsState.value.filter(item => item.id !== contentId)
  }

  const reset = () => {
    itemsState.value = []
    cursorState.value = null
    hasMoreState.value = true
    pendingState.value = false
    errorState.value = null
    initializedState.value = false
  }

  const hasContent = (contentId: string | null | undefined) => {
    if (!contentId)
      return false
    return itemsState.value.some(item => item.id === contentId)
  }

  return {
    items: computed(() => itemsState.value),
    pending: computed(() => pendingState.value),
    error: computed(() => errorState.value),
    hasMore: computed(() => hasMoreState.value && Boolean(cursorState.value)),
    initialized: computed(() => initializedState.value),
    loadInitial,
    refresh,
    loadMore,
    upsert,
    remove,
    reset,
    hasContent
  }
}
