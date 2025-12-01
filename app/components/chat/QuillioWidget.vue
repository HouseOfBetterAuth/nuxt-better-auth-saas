<script setup lang="ts">
import type { ContentType } from '#shared/constants/contentTypes'
import type { ChatActionSuggestion, ChatMessage } from '#shared/utils/types'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { useLocalStorage } from '@vueuse/core'

const router = useRouter()
const { loggedIn, signInAnonymous, useActiveOrganization, refreshActiveOrg } = useAuth()
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  actions,
  sessionId,
  createContentFromConversation,
  executeAction
} = useChatSession()

const prompt = ref('')
const promptSubmitting = ref(false)
const createDraftLoading = ref(false)
const createDraftError = ref<string | null>(null)
const selectedContentType = ref<ContentType>(CONTENT_TYPE_OPTIONS[0]?.value ?? 'blog_post')
const actionLoading = ref<string | null>(null)
const quickActionsState = reactive({
  transcript: false,
  youtube: false
})
const linkedSources = ref<Array<{ id: string, type: 'transcript' | 'youtube', value: string }>>([])
const toolSubmitLoading = ref<'transcript' | 'youtube' | null>(null)

const activeWorkspaceId = ref<string | null>(null)
const workspaceDetail = ref<any | null>(null)
const workspaceLoading = ref(false)
const {
  data: workspaceDraftsPayload,
  pending: draftsPending,
  refresh: refreshDrafts
} = await useFetch<{ contents: any[] }>('/api/chat/workspace', {
  default: () => ({
    contents: []
  })
})
const isWorkspaceActive = computed(() => Boolean(activeWorkspaceId.value))

const anonymousDraftCount = import.meta.client ? useLocalStorage<number>('quillio-anon-draft-count', 0) : ref(0)
const ANON_DRAFT_LIMIT = 5
const remainingAnonDrafts = computed(() => Math.max(0, ANON_DRAFT_LIMIT - (anonymousDraftCount.value || 0)))
const hasReachedAnonLimit = computed(() => !loggedIn.value && (anonymousDraftCount.value || 0) >= ANON_DRAFT_LIMIT)

const contentEntries = computed(() => {
  const list = Array.isArray(workspaceDraftsPayload.value?.contents) ? workspaceDraftsPayload.value?.contents : []
  return list.map((entry: any) => {
    const sections = Array.isArray(entry.currentVersion?.sections) ? entry.currentVersion.sections : []
    const wordCount = sections.reduce((sum: number, section: Record<string, any>) => {
      const rawValue = typeof section.wordCount === 'string' ? Number.parseInt(section.wordCount, 10) : Number(section.wordCount)
      const safeValue = Number.isFinite(rawValue) ? rawValue : 0
      return sum + safeValue
    }, 0)

    let updatedAt: Date | null = null
    if (entry.content.updatedAt) {
      const parsedDate = new Date(entry.content.updatedAt)
      updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
    }

    return {
      id: entry.content.id,
      title: entry.content.title || 'Untitled draft',
      slug: entry.content.slug,
      status: entry.content.status,
      updatedAt,
      contentType: entry.currentVersion?.frontmatter?.contentType || entry.content.contentType,
      sectionsCount: sections.length,
      wordCount: Number.isFinite(wordCount) ? wordCount : 0,
      sourceType: entry.sourceContent?.sourceType ?? null
    }
  })
})

const hasContent = computed(() => contentEntries.value.length > 0)
const activeWorkspaceEntry = computed(() => contentEntries.value.find(entry => entry.id === activeWorkspaceId.value) ?? null)
const isWorkspaceLoading = computed(() => workspaceLoading.value && isWorkspaceActive.value && !workspaceDetail.value)
const canStartDraft = computed(() => messages.value.length > 0 && !!sessionId.value && !isBusy.value)
const isStreaming = computed(() => ['submitted', 'streaming'].includes(status.value))

const createDraftCta = computed(() => {
  if (!loggedIn.value && hasReachedAnonLimit.value) {
    return 'Sign up to keep drafting'
  }
  return loggedIn.value ? 'Create draft' : `Save draft (${remainingAnonDrafts.value} left)`
})

const handlePromptSubmit = async () => {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }
  promptSubmitting.value = true
  try {
    await sendMessage(trimmed)
    prompt.value = ''
  } finally {
    promptSubmitting.value = false
  }
}

const handleAction = async (action: ChatActionSuggestion) => {
  const key = `${action.type}-${action.sourceContentId || ''}`
  actionLoading.value = key
  try {
    await executeAction(action)
  } finally {
    actionLoading.value = null
  }
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function addLinkedSource(entry: { type: 'transcript' | 'youtube', value: string }) {
  linkedSources.value = [
    ...linkedSources.value,
    {
      id: createLocalId(),
      type: entry.type,
      value: entry.value
    }
  ]
}

const handleTranscriptTool = async (payload: { text: string }) => {
  const transcriptMessage = [
    'Transcript attachment:',
    payload.text
  ].join('\n\n')
  const summary = `Transcript attached (${payload.text.length.toLocaleString()} characters)`

  toolSubmitLoading.value = 'transcript'
  try {
    await sendMessage(transcriptMessage, { displayContent: summary })
    addLinkedSource({ type: 'transcript', value: payload.text })
    quickActionsState.transcript = false
  } catch (error: any) {
    console.error('Failed to send transcript message', error)
    const errorMsg = error?.data?.message || error?.message || 'Unable to send transcript. Please try again.'
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      content: `❌ ${errorMsg}`,
      createdAt: new Date()
    })
  } finally {
    toolSubmitLoading.value = null
  }
}

const handleYoutubeTool = async (payload: { url: string }) => {
  const summary = `YouTube link added (${payload.url})`

  toolSubmitLoading.value = 'youtube'
  try {
    await sendMessage(`Reference video: ${payload.url}`, { displayContent: summary })
    addLinkedSource({ type: 'youtube', value: payload.url })
    quickActionsState.youtube = false
  } catch (error: any) {
    console.error('Failed to send YouTube link', error)
    const errorMsg = error?.data?.message || error?.message || 'Unable to send YouTube link. Please try again.'
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      content: `❌ ${errorMsg}`,
      createdAt: new Date()
    })
  } finally {
    toolSubmitLoading.value = null
  }
}

function removeLinkedSource(id: string) {
  linkedSources.value = linkedSources.value.filter(entry => entry.id !== id)
}

const loadWorkspaceDetail = async (contentId: string) => {
  workspaceLoading.value = true
  workspaceDetail.value = null
  try {
    const response = await $fetch<{ drafts?: any[], workspace?: any | null }>('/api/chat/workspace', {
      query: { contentId }
    })
    if (Array.isArray(response?.contents)) {
      workspaceDraftsPayload.value = { contents: response.contents }
    }
    workspaceDetail.value = response?.workspace ?? null
  } catch (error) {
    console.error('Unable to load workspace', error)
    workspaceDetail.value = null
  } finally {
    workspaceLoading.value = false
  }
}

const openWorkspace = async (entry: { id: string, slug?: string | null }) => {
  activeWorkspaceId.value = entry.id
  await loadWorkspaceDetail(entry.id)
}

const closeWorkspace = () => {
  activeWorkspaceId.value = null
  workspaceDetail.value = null
  workspaceLoading.value = false
}

const handleCreateDraft = async () => {
  createDraftError.value = null
  if (!canStartDraft.value) {
    return
  }

  if (!loggedIn.value && hasReachedAnonLimit.value) {
    const redirectUrl = `/signup?redirect=${encodeURIComponent('/chat')}`
    router.push(redirectUrl)
    return
  }

  if (!activeOrgState.value?.data?.slug) {
    await refreshActiveOrg()
  }

  createDraftLoading.value = true
  try {
    const firstUserMessage = messages.value.find(message => message.role === 'user')
    const fallbackTitle = 'Quillio draft'
    const response = await createContentFromConversation({
      title: firstUserMessage?.content?.slice(0, 80) || fallbackTitle,
      contentType: selectedContentType.value,
      messageIds: messages.value.map(message => message.id)
    })

    if (!loggedIn.value && !hasReachedAnonLimit.value) {
      anonymousDraftCount.value = (anonymousDraftCount.value || 0) + 1
    }

    if (response?.content?.id) {
      activeWorkspaceId.value = response.content.id
      await loadWorkspaceDetail(response.content.id)
      await refreshDrafts()
    }
  } catch (error: any) {
    const errorMsg = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to create a draft from this conversation.'
    createDraftError.value = errorMsg

    // Also add error as a chat message
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      content: `❌ Error: ${errorMsg}`,
      createdAt: new Date()
    })
  } finally {
    createDraftLoading.value = false
  }
}

const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  prompt.value = message.content
  await handlePromptSubmit()
}

const focusChatInput = () => {
  const input = document.querySelector('[placeholder="Describe what you need..."]') as HTMLElement
  input?.focus()
}

if (import.meta.client) {
  watch(loggedIn, async (value) => {
    if (!value) {
      await signInAnonymous()
    }
    await refreshDrafts()
  }, { immediate: true })
}
</script>

<template>
  <UContainer class="py-4 sm:py-8 space-y-6 sm:space-y-8 max-w-4xl mx-auto px-4 sm:px-6">
    <div
      v-if="!isWorkspaceActive"
      class="space-y-4"
    >
      <h1 class="text-2xl sm:text-3xl font-semibold text-center">
        What should we write next?
      </h1>

      <!-- Empty state: Context-first flow with clear action buttons -->
      <div
        v-if="!messages.length"
        class="space-y-4 w-full"
      >
        <div class="flex flex-wrap items-center justify-center gap-3 w-full">
          <UButton
            size="lg"
            variant="soft"
            color="primary"
            icon="i-lucide-file-text"
            :disabled="toolSubmitLoading !== null"
            @click="quickActionsState.youtube = false; quickActionsState.transcript = !quickActionsState.transcript"
          >
            Paste transcript
          </UButton>
          <UButton
            size="lg"
            variant="soft"
            color="neutral"
            icon="i-lucide-youtube"
            :disabled="toolSubmitLoading !== null"
            @click="quickActionsState.transcript = false; quickActionsState.youtube = !quickActionsState.youtube"
          >
            Add YouTube link
          </UButton>
          <UButton
            size="lg"
            variant="outline"
            @click="focusChatInput"
          >
            Type your request
          </UButton>
        </div>

        <!-- Tools appear when buttons are clicked -->
        <div class="w-full space-y-3">
          <ToolTranscript
            v-model:open="quickActionsState.transcript"
            :loading="toolSubmitLoading === 'transcript'"
            @submit="handleTranscriptTool"
          />
          <ToolYoutube
            v-model:open="quickActionsState.youtube"
            :loading="toolSubmitLoading === 'youtube'"
            @submit="handleYoutubeTool"
          />
        </div>
      </div>
    </div>
    <div class="space-y-6">
      <!-- Error messages are now shown in chat, but keep banner as fallback for non-chat errors -->
      <UAlert
        v-if="errorMessage && !messages.length"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :description="errorMessage"
        class="w-full max-w-2xl mx-auto"
      />

      <div
        v-if="isWorkspaceActive && activeWorkspaceEntry"
        class="space-y-4 w-full"
      >
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-muted-200/70 bg-muted/20 px-4 py-3 w-full">
          <div>
            <p class="text-sm font-semibold">
              {{ activeWorkspaceEntry?.title || 'Draft' }}
            </p>
          </div>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="closeWorkspace"
          >
            Back to chat
          </UButton>
        </div>

        <div
          v-if="isWorkspaceLoading"
          class="flex items-center gap-3 rounded-2xl border border-muted-200/70 bg-muted/20 px-4 py-3 text-sm text-muted-500"
        >
          <UIcon
            name="i-lucide-loader"
            class="h-4 w-4 animate-spin"
          />
          Loading draft…
        </div>

        <ChatDraftWorkspace
          v-if="workspaceDetail?.content?.id"
          :content-id="workspaceDetail.content.id"
          :organization-slug="workspaceDetail.content.slug || activeOrgState?.value?.data?.slug || null"
          :initial-payload="workspaceDetail"
          :show-back-button="true"
          @close="closeWorkspace"
        />
      </div>

      <template v-else>
        <div
          v-if="messages.length"
          class="space-y-4 w-full"
        >
          <div class="w-full max-w-3xl mx-auto">
            <div
              v-if="isStreaming"
              class="flex items-center justify-center gap-2 text-sm text-muted-500 mb-4"
            >
              <span class="h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
              <span>Quillio is thinking...</span>
            </div>

            <div class="min-h-[200px]">
              <ChatMessagesList
                :messages="messages"
                @regenerate="handleRegenerate"
              />
            </div>
          </div>

          <!-- Reference material ready to use -->
          <div
            v-if="actions.length"
            class="w-full max-w-2xl mx-auto space-y-3"
          >
            <div
              v-for="action in actions"
              :key="`${action.type}-${action.sourceContentId || ''}`"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
            >
              <div>
                <p class="text-sm font-medium">
                  {{ action.label || 'Reference material ready' }}
                </p>
              </div>
              <UButton
                size="sm"
                color="primary"
                :loading="actionLoading === `${action.type}-${action.sourceContentId || ''}`"
                @click="handleAction(action)"
              >
                Use this
              </UButton>
            </div>
          </div>
        </div>

        <div class="w-full max-w-2xl mx-auto space-y-4">
          <!-- Show linked sources if any -->
          <div
            v-if="linkedSources.length"
            class="flex flex-wrap gap-2"
          >
            <UBadge
              v-for="source in linkedSources"
              :key="source.id"
              size="sm"
              :color="source.type === 'transcript' ? 'primary' : 'neutral'"
              class="flex items-center gap-1"
            >
              <UIcon
                :name="source.type === 'transcript' ? 'i-lucide-file-text' : 'i-lucide-youtube'"
              />
              {{ source.type === 'transcript' ? 'Transcript' : 'YouTube link' }}
              <UButton
                variant="link"
                size="xs"
                icon="i-lucide-x"
                @click.stop="removeLinkedSource(source.id)"
              />
            </UBadge>
          </div>

          <!-- Add more information -->
          <div
            v-if="messages.length"
            class="flex flex-wrap items-center gap-2"
          >
            <UButton
              size="sm"
              variant="soft"
              color="primary"
              icon="i-lucide-file-text"
              @click="quickActionsState.youtube = false; quickActionsState.transcript = !quickActionsState.transcript"
            >
              Paste transcript
            </UButton>
            <UButton
              size="sm"
              variant="soft"
              color="neutral"
              icon="i-lucide-youtube"
              @click="quickActionsState.transcript = false; quickActionsState.youtube = !quickActionsState.youtube"
            >
              Add YouTube link
            </UButton>
          </div>

          <!-- Tools appear here when clicked (only when messages exist) -->
          <div
            v-if="messages.length"
            class="w-full space-y-3"
          >
            <ToolTranscript
              v-model:open="quickActionsState.transcript"
              :loading="toolSubmitLoading === 'transcript'"
              @submit="handleTranscriptTool"
            />
            <ToolYoutube
              v-model:open="quickActionsState.youtube"
              :loading="toolSubmitLoading === 'youtube'"
              @submit="handleYoutubeTool"
            />
          </div>

          <!-- Main chat input -->
          <div class="flex flex-col gap-3 sm:flex-row w-full">
            <UChatPrompt
              v-model="prompt"
              placeholder="Describe what you need..."
              variant="subtle"
              :disabled="isBusy || promptSubmitting"
              class="flex-1 w-full"
              @submit="handlePromptSubmit"
            >
              <UChatPromptSubmit :status="promptSubmitting ? 'submitted' : status" />
            </UChatPrompt>

            <USelectMenu
              v-model="selectedContentType"
              :items="CONTENT_TYPE_OPTIONS"
              value-key="value"
              class="w-full sm:w-[160px]"
              size="md"
            />
          </div>

          <!-- Draft creation - only show when there are messages -->
          <div
            v-if="messages.length"
            class="space-y-2"
          >
            <UButton
              block
              color="primary"
              :loading="createDraftLoading"
              :disabled="!canStartDraft"
              @click="handleCreateDraft"
            >
              {{ createDraftCta }}
            </UButton>
            <p
              v-if="!loggedIn && remainingAnonDrafts < ANON_DRAFT_LIMIT"
              class="text-xs text-muted-500 text-center"
            >
              {{ remainingAnonDrafts > 0 ? `${remainingAnonDrafts} draft${remainingAnonDrafts === 1 ? '' : 's'} left` : 'Sign up to save more' }}
            </p>

            <UAlert
              v-if="createDraftError"
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
              :description="createDraftError"
            />
          </div>
        </div>
      </template>
    </div>
    <section class="space-y-3 w-full">
      <div class="flex items-center justify-between w-full">
        <p class="text-sm font-semibold">
          Your drafts
        </p>
        <UButton
          size="xs"
          color="primary"
          variant="ghost"
          @click="router.push('/content')"
        >
          View all
        </UButton>
      </div>

      <div
        v-if="draftsPending"
        class="space-y-2"
      >
        <div class="h-12 rounded-md bg-muted animate-pulse" />
        <div class="h-12 rounded-md bg-muted animate-pulse" />
        <div class="h-12 rounded-md bg-muted animate-pulse" />
      </div>
      <div
        v-else-if="hasContent"
        class="rounded-2xl border border-muted-200/60 divide-y divide-muted-200/60"
      >
        <article
          v-for="entry in contentEntries"
          :key="entry.id"
          class="p-4 sm:p-5 space-y-3"
        >
          <div class="flex flex-wrap justify-between gap-4">
            <div>
              <p class="font-medium leading-tight">
                {{ entry.title }}
              </p>
              <p class="text-xs text-muted-500">
                Updated {{ entry.updatedAt ? entry.updatedAt.toLocaleDateString() : '—' }}
              </p>
            </div>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              @click="openWorkspace(entry)"
            >
              Open draft
            </UButton>
          </div>
          <div class="flex flex-wrap gap-4 text-xs text-muted-500">
            <span>{{ entry.sectionsCount }} sections</span>
            <span v-if="entry.wordCount">
              {{ entry.wordCount }} words
            </span>
            <span
              v-if="entry.sourceType"
              class="capitalize"
            >
              From: {{ entry.sourceType.replace('_', ' ') }}
            </span>
          </div>
        </article>
      </div>
      <div
        v-else
        class="rounded-2xl border border-dashed border-muted-200/70 p-5 text-center text-sm text-muted-500"
      >
        No drafts yet
      </div>
    </section>
  </UContainer>
</template>
