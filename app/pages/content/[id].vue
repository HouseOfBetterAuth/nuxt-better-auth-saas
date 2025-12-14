<script setup lang="ts">
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'

const { formatDateRelative } = useDate()

interface ContentEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  additions?: number
  deletions?: number
  conversationId?: string | null
  bodyMdx?: string
}

interface ContentApiResponse {
  workspace?: {
    content?: {
      id?: string
      title?: string
      slug?: string
      status?: string
      updatedAt?: string
      contentType?: string
      conversationId?: string | null
    }
    currentVersion?: {
      bodyMdx?: string
      diffStats?: {
        additions?: number
        deletions?: number
      }
      frontmatter?: {
        contentType?: string
        diffStats?: {
          additions?: number
          deletions?: number
        }
      }
    }
  }
}

definePageMeta({
  // Uses default layout which adapts based on workspace header state
  ssr: false // Client-side only to prevent hydration mismatches
})

const route = useRoute()
const router = useRouter()
const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

// Set workspace header state
const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => true)

const setShellHeader = () => {
  workspaceHeader.value = {
    title: 'Loading content…',
    status: null,
    contentType: null,
    updatedAtLabel: null,
    versionId: null,
    additions: 0,
    deletions: 0,
    contentId: contentId.value || undefined,
    showBackButton: true,
    onBack: null, // Set to function in onMounted to avoid hydration mismatch
    onArchive: null,
    onShare: null,
    onPrimaryAction: null,
    primaryActionLabel: '',
    primaryActionColor: '',
    primaryActionDisabled: false
  }
}

setShellHeader()

// Fetch content data (client-side only for instant navigation)
const { data: contentData, pending, error } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  server: false, // Client-side only - instant skeleton, no SSR blocking
  default: () => null
})

// Transform to ContentEntry format
const contentEntry = computed<ContentEntry | null>(() => {
  if (!contentData.value)
    return null

  const entry = contentData.value as ContentApiResponse
  const workspace = entry.workspace
  const content = workspace?.content
  const currentVersion = workspace?.currentVersion

  if (!content)
    return null

  let updatedAt: Date | null = null
  if (content?.updatedAt) {
    const parsedDate = new Date(content.updatedAt)
    updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
  }

  const versionStats = currentVersion?.diffStats
  const fmStats = currentVersion?.frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
  const additions = versionStats?.additions ?? fmStats?.additions ?? 0
  const deletions = versionStats?.deletions ?? fmStats?.deletions ?? 0

  return {
    id: content?.id || '',
    title: content?.title || 'Untitled content',
    slug: content?.slug || '',
    status: content?.status || 'draft',
    updatedAt,
    contentType: currentVersion?.frontmatter?.contentType || content?.contentType || 'content',
    additions,
    deletions,
    conversationId: content?.conversationId || null,
    bodyMdx: currentVersion?.bodyMdx || ''
  }
})

// Helper to set onBack callback (used after mount to avoid hydration mismatch)
const setOnBackCallback = () => {
  if (workspaceHeader.value) {
    workspaceHeader.value.onBack = () => {
      router.push('/content')
    }
  }
}

// Track if component is mounted (client-side only)
const isMounted = ref(false)

// Set onBack callback after mount to avoid hydration mismatch
onMounted(() => {
  isMounted.value = true
  setOnBackCallback()
})

// Update workspace header when content loads
watch(contentEntry, (entry) => {
  if (entry) {
    const updatedAtLabel = formatDateRelative(entry.updatedAt, { includeTime: true })

    workspaceHeader.value = {
      title: entry.title,
      status: entry.status,
      contentType: entry.contentType,
      updatedAtLabel,
      versionId: null,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
      contentId: entry.id,
      showBackButton: true,
      onBack: null, // Set to function after mount to avoid hydration mismatch
      onArchive: null,
      onShare: null,
      onPrimaryAction: null,
      primaryActionLabel: '',
      primaryActionColor: '',
      primaryActionDisabled: false
    }

    // Update onBack callback if already mounted (in case this watch runs after mount)
    if (isMounted.value) {
      setOnBackCallback()
    }

    workspaceHeaderLoading.value = false
  }
}, { immediate: true })

watchEffect(() => {
  if (!contentEntry.value) {
    workspaceHeaderLoading.value = pending.value
  }
})
</script>

<template>
  <div class="w-full h-full flex flex-col py-4 px-4 sm:px-6">
    <div class="w-full">
      <div class="space-y-8">
        <!-- Loading skeleton -->
        <div
          v-if="pending"
          class="space-y-4"
        >
          <USkeleton class="h-20 w-full rounded-lg" />
          <USkeleton class="h-32 w-3/4 rounded-lg" />
          <USkeleton class="h-24 w-full rounded-lg" />
        </div>

        <!-- Error banner -->
        <UAlert
          v-else-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="error.message || 'Failed to load content'"
          class="w-full"
        />

        <!-- Content Display -->
        <template v-else-if="contentEntry">
          <div class="w-full">
            <UTextarea
              :model-value="contentEntry.bodyMdx || ''"
              placeholder="No content available"
              readonly
              autoresize
              class="w-full min-h-96"
            />
          </div>
        </template>

        <!-- Empty state -->
        <UAlert
          v-else
          color="neutral"
          variant="soft"
          icon="i-lucide-file-text"
          title="No content available"
          description="This content item could not be found or loaded."
          class="w-full"
        />
      </div>
    </div>
  </div>
</template>
