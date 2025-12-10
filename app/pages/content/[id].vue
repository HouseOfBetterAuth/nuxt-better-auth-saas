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
const { data: contentData, pending, error, refresh } = useFetch(() => `/api/content/${contentId.value}`, {
  key: () => `content-${contentId.value}`,
  lazy: true,
  server: false, // Client-side only - instant skeleton, no SSR blocking
  default: () => null
})

// Local editor content state (using HTML string for TipTap)
const editorContent = ref('')
const originalContent = ref('')
const isSaving = ref(false)

// Computed dirty state
const isDirty = computed(() => editorContent.value !== originalContent.value)

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

// Sync editor content with content - with dirty check to prevent overwriting edits
watch(contentEntry, (entry) => {
  if (entry && typeof entry.bodyMdx === 'string') {
    // Convert MDX to HTML for editor (simple conversion - MDX is mostly markdown)
    const htmlContent = entry.bodyMdx
    // If no local changes, or remote content matches what we started with, safe to update
    if (!isDirty.value || htmlContent === originalContent.value) {
      editorContent.value = htmlContent
      originalContent.value = htmlContent
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
    editorContent.value = pendingRemoteContent.value
    originalContent.value = pendingRemoteContent.value
    pendingRemoteContent.value = null
  }
  showConflictModal.value = false
}

const keepLocalChanges = () => {
  // Update baseline to remote so we don't re-trigger conflict on same content
  // User still has unsaved changes (isDirty remains true), but we acknowledge this remote version
  if (pendingRemoteContent.value !== null) {
    originalContent.value = pendingRemoteContent.value
  }
  pendingRemoteContent.value = null
  showConflictModal.value = false
}

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

// Save handler
const handleSave = async () => {
  if (!contentId.value || isSaving.value)
    return

  try {
    isSaving.value = true
    await $fetch(`/api/content/${contentId.value}`, {
      method: 'PATCH',
      body: {
        bodyMdx: editorContent.value
      }
    })
    // Update original content to match saved content
    originalContent.value = editorContent.value
    await refresh()
  } catch (err) {
    console.error('Failed to save content:', err)
  } finally {
    isSaving.value = false
  }
}
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

        <!-- Content Editor -->
        <template v-else-if="contentEntry">
          <!-- Editor -->
          <div class="w-full">
            <UTextarea
              v-model="editorContent"
              placeholder="Start writing your content..."
              autoresize
              class="w-full min-h-96"
            />
          </div>

          <!-- Save Button -->
          <div class="flex justify-end">
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

          <!-- Chat Widget Below Editor -->
          <ClientOnly>
            <div
              v-if="contentEntry"
              class="w-full"
            >
              <QuillioWidget
                :content-id="contentEntry.id"
                :conversation-id="contentEntry.conversationId"
                initial-mode="agent"
              />
            </div>
          </ClientOnly>
        </template>
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
  </div>
</template>
