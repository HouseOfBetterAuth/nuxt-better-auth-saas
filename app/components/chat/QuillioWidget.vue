<script setup lang="ts">
import type { ContentType } from '#shared/constants/contentTypes'
import type { ChatMessage } from '#shared/utils/types'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { ANONYMOUS_DRAFT_LIMIT } from '#shared/constants/limits'
import { useClipboard, useLocalStorage } from '@vueuse/core'

const router = useRouter()
const route = useRoute()
const { loggedIn, useActiveOrganization, refreshActiveOrg } = useAuth()
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  sessionId,
  createContentFromConversation
} = useChatSession()

const prompt = ref('')
const promptSubmitting = ref(false)
const createDraftLoading = ref(false)
const createDraftError = ref<string | null>(null)
const selectedContentType = ref<ContentType>(CONTENT_TYPE_OPTIONS[0]?.value ?? 'blog_post')
const linkedSources = ref<Array<{ id: string, type: 'transcript', value: string }>>([])
const { copy } = useClipboard()
const toast = useToast()

const activeWorkspaceId = ref<string | null>(null)
const workspaceDetail = ref<any | null>(null)
const workspaceLoading = ref(false)
interface AnonymousUsagePayload {
  limit: number
  used: number
  remaining: number
}

interface WorkspaceResponse {
  contents: any[]
  anonymousUsage?: AnonymousUsagePayload | null
}

const {
  data: workspaceDraftsPayload,
  pending: draftsPending,
  refresh: refreshDrafts
} = await useFetch<WorkspaceResponse>('/api/chat/workspace', {
  default: () => ({
    contents: []
  })
})
const isWorkspaceActive = computed(() => Boolean(activeWorkspaceId.value))

const anonymousUsage = computed<AnonymousUsagePayload | null>(() => workspaceDraftsPayload.value?.anonymousUsage ?? null)
const anonDraftLimit = computed(() => anonymousUsage.value?.limit ?? ANONYMOUS_DRAFT_LIMIT)
const remainingAnonDrafts = computed(() => {
  if (loggedIn.value)
    return anonDraftLimit.value
  if (anonymousUsage.value)
    return anonymousUsage.value.remaining
  return ANONYMOUS_DRAFT_LIMIT
})
const hasReachedAnonLimit = computed(() => !loggedIn.value && remainingAnonDrafts.value <= 0)

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

    const versionStats = entry.currentVersion?.diffStats
    const fmStats = entry.currentVersion?.frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
    const additions = Number(versionStats?.additions ?? fmStats?.additions ?? 0)
    const deletions = Number(versionStats?.deletions ?? fmStats?.deletions ?? 0)

    return {
      id: entry.content.id,
      title: entry.content.title || 'Untitled draft',
      slug: entry.content.slug,
      status: entry.content.status,
      updatedAt,
      contentType: entry.currentVersion?.frontmatter?.contentType || entry.content.contentType,
      sectionsCount: sections.length,
      wordCount: Number.isFinite(wordCount) ? wordCount : 0,
      sourceType: entry.sourceContent?.sourceType ?? null,
      additions: Number.isFinite(additions) ? additions : undefined,
      deletions: Number.isFinite(deletions) ? deletions : undefined
    }
  })
})

const activeWorkspaceEntry = computed(() => contentEntries.value.find(entry => entry.id === activeWorkspaceId.value) ?? null)
const isWorkspaceLoading = computed(() => workspaceLoading.value && isWorkspaceActive.value && !workspaceDetail.value)
const canStartDraft = computed(() => messages.value.length > 0 && !!sessionId.value && !isBusy.value)
const isStreaming = computed(() => ['submitted', 'streaming'].includes(status.value))
const uiStatus = computed(() => status.value === 'idle' ? 'ready' : status.value)

const createDraftCta = computed(() => {
  if (!loggedIn.value && hasReachedAnonLimit.value) {
    return 'Sign up to keep drafting'
  }
  return loggedIn.value ? 'Create draft' : `Save draft (${remainingAnonDrafts.value} left)`
})

const handlePromptSubmit = async (value?: string) => {
  const input = typeof value === 'string' ? value : prompt.value
  const trimmed = input.trim()
  if (!trimmed) {
    return
  }
  const transcriptHandled = await maybeHandleTranscriptSubmission(trimmed)
  if (transcriptHandled) {
    prompt.value = ''
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

function createLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function addLinkedSource(entry: { type: 'transcript', value: string }) {
  linkedSources.value = [
    ...linkedSources.value,
    {
      id: createLocalId(),
      type: entry.type,
      value: entry.value
    }
  ]
}

const transcriptPrefixPattern = /^transcript attachment:\s*/i

function shouldTreatAsTranscript(input: string) {
  const value = input.trim()
  if (!value) {
    return false
  }
  if (transcriptPrefixPattern.test(value)) {
    return true
  }
  const timestampMatches = value.match(/\b\d{2}:\d{2}:\d{2}\b/g)?.length ?? 0
  const hashHeadingMatches = value.split(/\n+/).filter(line => line.trim().startsWith('#')).length
  return value.length > 800 && (timestampMatches >= 3 || hashHeadingMatches >= 2)
}

function extractTranscriptBody(input: string) {
  return input.replace(transcriptPrefixPattern, '').trim()
}

async function submitTranscript(text: string) {
  if (!text) {
    return
  }
  const transcriptMessage = [
    'Transcript attachment:',
    text
  ].join('\n\n')
  const summary = `Transcript attached (${text.length.toLocaleString()} characters)`

  promptSubmitting.value = true
  try {
    await sendMessage(transcriptMessage, { displayContent: summary })
    addLinkedSource({ type: 'transcript', value: text })
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
    promptSubmitting.value = false
  }
}

async function maybeHandleTranscriptSubmission(raw: string) {
  if (!shouldTreatAsTranscript(raw)) {
    return false
  }
  const text = extractTranscriptBody(raw)
  await submitTranscript(text || raw.trim())
  return true
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

const normalizeDraftId = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : null
  }
  return typeof value === 'string' ? value : null
}

const resetWorkspaceState = () => {
  activeWorkspaceId.value = null
  workspaceDetail.value = null
  workspaceLoading.value = false
}

const updateDraftRoute = async (draftId: string | null) => {
  const nextQuery = { ...route.query }
  if (draftId) {
    nextQuery.draft = draftId
  } else {
    delete nextQuery.draft
  }
  try {
    await router.replace({ query: nextQuery })
  } catch (error) {
    console.warn('Failed to update draft route', error)
  }
}

const openWorkspace = async (entry: { id: string, slug?: string | null }) => {
  await updateDraftRoute(entry.id)
}

const closeWorkspace = async () => {
  resetWorkspaceState()
  await updateDraftRoute(null)
}

const handleCreateDraft = async () => {
  createDraftError.value = null
  if (!canStartDraft.value) {
    return
  }

  if (!loggedIn.value && hasReachedAnonLimit.value) {
    const redirectUrl = `/signup?redirect=${encodeURIComponent('/')}`
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
      title: firstUserMessage?.parts?.[0]?.text?.slice(0, 80) || fallbackTitle,
      contentType: selectedContentType.value,
      messageIds: messages.value.map(message => message.id)
    })

    if (response?.content?.id) {
      await updateDraftRoute(response.content.id)
      await refreshDrafts()
    }
  } catch (error: any) {
    const errorMsg = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to create a draft from this conversation.'
    createDraftError.value = errorMsg

    // Also add error as a chat message
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      parts: [{ type: 'text', text: `❌ Error: ${errorMsg}` }],
      createdAt: new Date()
    })
  } finally {
    createDraftLoading.value = false
  }
}

watch(() => route.query.draft, async (value) => {
  const draftId = normalizeDraftId(value)
  if (!draftId) {
    resetWorkspaceState()
    return
  }
  if (activeWorkspaceId.value === draftId && workspaceDetail.value) {
    return
  }
  activeWorkspaceId.value = draftId
  await loadWorkspaceDetail(draftId)
}, { immediate: true })

const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  const text = message.parts[0]?.text || ''
  prompt.value = text
  await handlePromptSubmit(text)
}

function handleCopy(message: ChatMessage) {
  const text = message.parts[0]?.text || ''
  copy(text)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied successfully.',
    color: 'primary'
  })
}

if (import.meta.client) {
  watch(loggedIn, async () => {
    await refreshDrafts()
  }, { immediate: true })
}
</script>

<template>
  <div class="w-full py-4 sm:py-8 space-y-6 sm:space-y-8">
    <div class="max-w-4xl mx-auto px-4 sm:px-6">
      <div
        v-if="!isWorkspaceActive"
        class="space-y-4"
      >
        <h1 class="text-2xl sm:text-3xl font-semibold text-center">
          What should we write next?
        </h1>

        <!-- Empty state helper -->
        <div
          v-if="!messages.length"
          class="text-sm text-muted-500 text-center"
        >
          Paste a YouTube transcript directly into the chat input below or describe what you need.
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
          <USkeleton
            v-if="isWorkspaceLoading"
            class="rounded-2xl border border-muted-200/70 p-4"
          >
            <div class="h-4 rounded bg-muted/70" />
            <div class="mt-2 space-y-2">
              <div class="h-3 rounded bg-muted/60" />
              <div class="h-3 rounded bg-muted/50" />
            </div>
          </USkeleton>

          <ChatDraftWorkspace
            v-if="workspaceDetail?.content?.id"
            :content-id="workspaceDetail.content.id"
            :organization-slug="workspaceDetail.content.slug || activeOrgState?.value?.data?.slug || null"
            :initial-payload="workspaceDetail"
            :show-back-button="true"
            :back-to="null"
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
                <UChatMessages
                  :messages="messages"
                  :status="uiStatus"
                  should-auto-scroll
                  :assistant="{
                    actions: [
                      {
                        label: 'Copy',
                        icon: 'i-lucide-copy',
                        onClick: (e, message) => handleCopy(message as ChatMessage)
                      },
                      {
                        label: 'Regenerate',
                        icon: 'i-lucide-rotate-ccw',
                        onClick: (e, message) => handleRegenerate(message as ChatMessage)
                      }
                    ]
                  }"
                  :user="{
                    actions: [
                      {
                        label: 'Copy',
                        icon: 'i-lucide-copy',
                        onClick: (e, message) => handleCopy(message as ChatMessage)
                      },
                      {
                        label: 'Send again',
                        icon: 'i-lucide-send',
                        onClick: (e, message) => {
                          const text = (message as ChatMessage).parts[0]?.text || ''
                          if (text) {
                            handlePromptSubmit(text)
                          }
                        }
                      }
                    ]
                  }"
                >
                  <template #content="{ message }">
                    <div class="whitespace-pre-line">
                      {{ message.parts[0]?.text }}
                    </div>
                  </template>
                </UChatMessages>
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
                color="primary"
                class="flex items-center gap-1"
              >
                <UIcon
                  name="i-lucide-file-text"
                />
                Transcript
                <UButton
                  variant="link"
                  size="xs"
                  icon="i-lucide-x"
                  @click.stop="removeLinkedSource(source.id)"
                />
              </UBadge>
            </div>

            <!-- Add more information -->
            <!-- Main chat input -->
            <div class="flex flex-col gap-3 sm:flex-row w-full">
              <UChatPrompt
                v-model="prompt"
                placeholder="Paste a transcript or describe what you need..."
                variant="subtle"
                :disabled="isBusy || promptSubmitting"
                class="flex-1 w-full"
                @submit="handlePromptSubmit"
              >
                <UChatPromptSubmit :status="promptSubmitting ? 'submitted' : uiStatus" />
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
                v-if="!loggedIn && remainingAnonDrafts < anonDraftLimit"
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
      <ChatDraftsList
        v-if="!isWorkspaceActive"
        :drafts-pending="draftsPending"
        :content-entries="contentEntries"
        @open-workspace="openWorkspace"
      />
    </div>
  </div>
</template>
