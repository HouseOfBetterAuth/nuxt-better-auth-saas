<script setup lang="ts">
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

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
})

const route = useRoute()
const router = useRouter()
const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

// Chat widget visibility
const showChat = ref(false)

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

// Fetch content data
const { data: contentData, pending, error, refresh } = useFetch(() => `/api/content/${contentId.value}`, {
  key: () => `content-${contentId.value}`,
  lazy: true,
  server: true,
  default: () => null
})

// Local markdown state for editor
const markdown = ref('')
const originalMarkdown = ref('')
const isSaving = ref(false)

// Computed dirty state
const isDirty = computed(() => markdown.value !== originalMarkdown.value)

// Remote content change detection
const showConflictModal = ref(false)
const pendingRemoteContent = ref<string | null>(null)

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

// Sync markdown with content - with dirty check to prevent overwriting edits
watch(contentEntry, (entry) => {
  if (entry && typeof entry.bodyMdx === 'string') {
    // If no local changes, or remote content matches what we started with, safe to update
    if (!isDirty.value || entry.bodyMdx === originalMarkdown.value) {
      markdown.value = entry.bodyMdx
      originalMarkdown.value = entry.bodyMdx
    } else {
      // Remote content changed while we have unsaved local edits
      // Store pending remote content and show conflict modal
      pendingRemoteContent.value = entry.bodyMdx
      showConflictModal.value = true
    }
  }
}, { immediate: true })

// Handle conflict resolution
const acceptRemoteChanges = () => {
  if (pendingRemoteContent.value !== null) {
    markdown.value = pendingRemoteContent.value
    originalMarkdown.value = pendingRemoteContent.value
    pendingRemoteContent.value = null
  }
  showConflictModal.value = false
}

const keepLocalChanges = () => {
  // Update baseline to remote so we don't re-trigger conflict on same content
  // User still has unsaved changes (isDirty remains true), but we acknowledge this remote version
  if (pendingRemoteContent.value !== null) {
    originalMarkdown.value = pendingRemoteContent.value
  }
  pendingRemoteContent.value = null
  showConflictModal.value = false
}

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

// Save handler
const handleSave = async () => {
  if (!contentId.value || isSaving.value)
    return

  try {
    isSaving.value = true
    await $fetch(`/api/content/${contentId.value}`, {
      method: 'PATCH',
      body: {
        bodyMdx: markdown.value
      }
    })
    // Update original markdown to match saved content
    originalMarkdown.value = markdown.value
    await refresh()
  } catch (err) {
    console.error('Failed to save content:', err)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="w-full h-full relative">
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
      class="w-full h-full flex flex-col"
    >
      <!-- Editor Toolbar -->
      <div class="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3">
          <UButton
            v-if="contentEntry.conversationId"
            :to="`/conversations/${contentEntry.conversationId}`"
            variant="ghost"
            color="gray"
            size="sm"
            icon="i-lucide-message-circle"
          >
            View Conversation
          </UButton>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            :icon="showChat ? 'i-lucide-panel-right-close' : 'i-lucide-message-circle'"
            variant="ghost"
            color="gray"
            size="sm"
            @click="showChat = !showChat"
          >
            {{ showChat ? 'Hide Chat' : 'Show Chat' }}
          </UButton>
          <UButton
            icon="i-lucide-save"
            color="primary"
            size="sm"
            :loading="isSaving"
            @click="handleSave"
          >
            Save
          </UButton>
        </div>
      </div>

      <!-- MDX Editor -->
      <div class="flex-1 overflow-auto">
        <UTextarea
          v-model="markdown"
          :rows="30"
          placeholder="Start writing your content..."
          class="font-mono text-sm"
          autoresize
        />
      </div>
    </div>

    <!-- Conflict Resolution Modal -->
    <UModal
      v-model="showConflictModal"
      :prevent-close="true"
    >
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-alert-triangle"
              class="h-5 w-5 text-amber-500"
            />
            <h3 class="text-lg font-semibold">
              Content Conflict Detected
            </h3>
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            The remote content has been updated while you have unsaved local changes.
          </p>
          <p class="text-sm font-medium">
            What would you like to do?
          </p>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="gray"
              variant="ghost"
              @click="keepLocalChanges"
            >
              Keep My Changes
            </UButton>
            <UButton
              color="primary"
              @click="acceptRemoteChanges"
            >
              Accept Remote Changes
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Floating Chat Widget -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-all duration-300 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="translate-x-full opacity-0"
    >
      <div
        v-if="showChat && contentEntry"
        class="fixed top-0 right-0 h-screen w-[480px] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-2xl z-50 overflow-hidden"
      >
        <QuillioWidget
          :content-id="contentEntry.id"
          :conversation-id="contentEntry.conversationId"
          initial-mode="agent"
          class="h-full"
        />
      </div>
    </Transition>
  </div>
</template>
