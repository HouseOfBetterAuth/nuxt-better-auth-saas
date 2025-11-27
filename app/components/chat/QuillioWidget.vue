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
const isStreaming = computed(() => status.value === 'streaming')

const createDraftCta = computed(() => {
  if (!loggedIn.value && hasReachedAnonLimit.value) {
    return 'Sign up to keep drafting'
  }
  return loggedIn.value ? 'Start draft in workspace' : `Save draft (${remainingAnonDrafts.value} left)`
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
    createDraftError.value = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to create a draft from this conversation.'
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
  <UContainer class="py-8 space-y-8 max-w-4xl">
    <div
      v-if="!isWorkspaceActive"
      class="text-center"
    >
      <h1 class="text-3xl font-semibold">
        What should we write next?
      </h1>
    </div>
    <div class="space-y-6">
      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :description="errorMessage"
        class="max-w-2xl mx-auto"
      />

      <div
        v-if="isWorkspaceActive && activeWorkspaceEntry"
        class="space-y-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-muted-200/70 bg-muted/20 px-4 py-3">
          <div>
            <p class="text-sm font-semibold">
              {{ activeWorkspaceEntry?.title || 'Workspace draft' }}
            </p>
            <p class="text-xs text-muted-500">
              Editing inline — close to jump back into the conversation.
            </p>
          </div>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="closeWorkspace"
          >
            Close workspace
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
          Loading workspace…
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
          class="space-y-4"
        >
          <div class="max-w-3xl mx-auto">
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

          <div
            v-if="actions.length"
            class="max-w-2xl mx-auto space-y-3"
          >
            <p class="text-xs uppercase tracking-wide text-primary-600 text-center">
              Source detected
            </p>
            <div
              v-for="action in actions"
              :key="`${action.type}-${action.sourceContentId || ''}`"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
            >
              <div>
                <p class="text-sm font-medium">
                  {{ action.label || 'Source content detected' }}
                </p>
                <p class="text-xs text-muted-500">
                  {{ action.sourceType?.replace('_', ' ') || 'Source' }}
                </p>
              </div>
              <UButton
                size="xs"
                color="primary"
                :loading="actionLoading === `${action.type}-${action.sourceContentId || ''}`"
                @click="handleAction(action)"
              >
                Use source
              </UButton>
            </div>
          </div>
        </div>

        <div
          v-else
          class="text-sm text-muted-500 text-center py-10"
        >
          Send your first message above to start a conversation.
        </div>

        <div class="max-w-2xl mx-auto space-y-4">
          <div class="flex flex-col gap-3 sm:flex-row">
            <UChatPrompt
              v-model="prompt"
              placeholder="Describe what you need..."
              variant="subtle"
              :disabled="isBusy || promptSubmitting"
              class="flex-1"
              @submit="handlePromptSubmit"
            >
              <UChatPromptSubmit :status="promptSubmitting ? 'submitted' : status" />
            </UChatPrompt>

            <USelectMenu
              v-model="selectedContentType"
              :items="CONTENT_TYPE_OPTIONS"
              value-key="value"
              class="sm:w-[160px]"
              size="md"
            />
          </div>

          <UButton
            block
            color="primary"
            :loading="createDraftLoading"
            :disabled="!canStartDraft"
            @click="handleCreateDraft"
          >
            {{ createDraftCta }}
          </UButton>
          <p class="text-xs text-muted-500 text-center">
            We'll load the draft in-place so you can open the workspace only when you're ready.
          </p>
          <p
            v-if="!loggedIn && remainingAnonDrafts < ANON_DRAFT_LIMIT"
            class="text-xs text-muted-500 text-center"
          >
            {{ remainingAnonDrafts > 0 ? `You can save ${remainingAnonDrafts} more draft${remainingAnonDrafts === 1 ? '' : 's'} anonymously.` : 'Create a free account to keep saving drafts.' }}
          </p>

          <UAlert
            v-if="createDraftError"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :description="createDraftError"
          />
        </div>
      </template>
    </div>
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">
          Workspace drafts
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
              Open workspace
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
              Source: {{ entry.sourceType.replace('_', ' ') }}
            </span>
          </div>
        </article>
      </div>
      <div
        v-else
        class="rounded-2xl border border-dashed border-muted-200/70 p-5 text-center text-sm text-muted-500"
      >
        No drafts yet. Turn this conversation into your first piece.
      </div>
    </section>
  </UContainer>
</template>
