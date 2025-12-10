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
    onBack: () => {
      router.push('/content')
    },
    onArchive: null,
    onShare: null,
    onPrimaryAction: null,
    primaryActionLabel: '',
    primaryActionColor: '',
    primaryActionDisabled: false
  }
}

setShellHeader()

// Fetch content data - API uses active organization from session, no slug needed
const { data: contentData, pending, error } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  server: true,
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
    conversationId: content?.conversationId || null
  }
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
      onBack: () => {
        router.push('/content')
      },
      onArchive: null,
      onShare: null,
      onPrimaryAction: null,
      primaryActionLabel: '',
      primaryActionColor: '',
      primaryActionDisabled: false
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
  <div class="w-full py-8">
    <USkeleton
      v-if="pending"
      class="rounded-2xl border border-muted-200/70 p-4"
    >
      <div class="h-4 rounded bg-muted/70" />
      <div class="mt-2 space-y-2">
        <div class="h-3 rounded bg-muted/60" />
        <div class="h-3 rounded bg-muted/50" />
      </div>
    </USkeleton>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="error.message || 'Failed to load content'"
      class="w-full"
    />

    <div
      v-else-if="contentEntry"
      class="w-full"
    >
      <div class="w-full text-left py-4 px-1 space-y-2">
        <div class="flex items-center justify-between gap-3">
          <p class="font-medium leading-tight truncate">
            {{ contentEntry.title }}
          </p>
          <UBadge
            color="neutral"
            variant="soft"
            class="capitalize"
          >
            {{ contentEntry.status || 'draft' }}
          </UBadge>
        </div>
        <div class="text-xs text-muted-500 flex flex-wrap items-center gap-1">
          <span>{{ formatDateRelative(contentEntry.updatedAt) }}</span>
          <span>·</span>
          <span class="capitalize">
            {{ contentEntry.contentType || 'content' }}
          </span>
          <span>·</span>
          <span class="font-mono text-[11px] text-muted-600 truncate">
            {{ contentEntry.id }}
          </span>
          <span>·</span>
          <span class="text-emerald-500 dark:text-emerald-400">
            +{{ contentEntry.additions ?? 0 }}
          </span>
          <span class="text-rose-500 dark:text-rose-400">
            -{{ contentEntry.deletions ?? 0 }}
          </span>
        </div>
        <div
          v-if="contentEntry.conversationId"
          class="mt-4"
        >
          <UButton
            :to="`/conversations/${contentEntry.conversationId}`"
            variant="outline"
            color="primary"
            size="sm"
            icon="i-lucide-message-circle"
          >
            View Conversation
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
