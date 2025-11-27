<script setup lang="ts">
import type { ContentType } from '#shared/constants/contentTypes'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { useLocalStorage } from '@vueuse/core'

definePageMeta({
  auth: false,
  layout: false
})

const router = useRouter()
const toast = useToast()
const { loggedIn, user, signInAnonymous, useActiveOrganization, refreshActiveOrg } = useAuth()
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  actions,
  sessionId,
  createContentFromConversation
} = useChatSession()

const prompt = ref('')
const promptSubmitting = ref(false)
const createDraftLoading = ref(false)
const createDraftError = ref<string | null>(null)
const selectedContentType = ref<ContentType>(CONTENT_TYPE_OPTIONS[0]?.value ?? 'blog_post')
const anonymousDraftCount = import.meta.client ? useLocalStorage<number>('quillio-anon-draft-count', 0) : ref(0)
const ANON_DRAFT_LIMIT = 5
const remainingAnonDrafts = computed(() => Math.max(0, ANON_DRAFT_LIMIT - (anonymousDraftCount.value || 0)))
const hasReachedAnonLimit = computed(() => !loggedIn.value && (anonymousDraftCount.value || 0) >= ANON_DRAFT_LIMIT)

const { data: contents, pending: contentsPending, refresh: refreshContents } = await useFetch('/api/content', {
  immediate: false,
  default: () => []
})

const contentEntries = computed(() => {
  const list = Array.isArray(contents.value) ? contents.value : []
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

const canStartDraft = computed(() => messages.value.length > 0 && !!sessionId.value && !isBusy.value)
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

  const ensureOrgSlug = activeOrgState.value?.data?.slug
  if (!ensureOrgSlug) {
    // Refresh organization data to ensure we have an active organization
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
    // Increment draft count before navigation to ensure persistence
    if (!loggedIn.value && !hasReachedAnonLimit.value) {
      anonymousDraftCount.value = (anonymousDraftCount.value || 0) + 1
    }

    const activeSlug = activeOrgState.value?.data?.slug
    if (response?.content?.id && activeSlug) {
      await router.push(`/${activeSlug}/content/${response.content.id}`)
    } else {
      // TODO: Add success feedback when redirecting back to /chat
      // Consider showing toast or refreshing content to display new draft
      await router.push('/chat')
    }
  } catch (error: any) {
    createDraftError.value = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to create a draft from this conversation.'
  } finally {
    createDraftLoading.value = false
  }
}

const handleOpenDraft = (entry: { id: string, slug?: string | null }) => {
  const slug = entry.slug || activeOrgState.value?.data?.slug
  if (!slug) {
    toast.add({
      title: 'Workspace not ready',
      description: 'We are preparing your workspace. Try again in a few seconds.',
      color: 'warning'
    })
    return
  }
  router.push(`/${slug}/content/${entry.id}`)
}

if (import.meta.client) {
  watch(loggedIn, async (value) => {
    if (!value) {
      await signInAnonymous()
    }
    await refreshContents()
  }, { immediate: true })
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background">
    <header class="border-b border-muted-200/60 px-4 py-4 space-y-3">
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              {{ user ? 'Welcome back' : 'Try Quillio instantly' }}
            </p>
            <h1 class="text-2xl font-semibold">
              Guide Quillio with plain language
            </h1>
          </div>
          <USelectMenu
            v-model="selectedContentType"
            :items="CONTENT_TYPE_OPTIONS"
            value-key="value"
            class="min-w-[200px]"
          />
        </div>
        <p class="text-sm text-muted-500">
          Ask questions, give instructions, and convert the conversation into drafts without leaving this page.
        </p>
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
        />
        <UAlert
          v-if="actions.length"
          color="primary"
          variant="soft"
          icon="i-lucide-link"
          :description="`Detected ${actions.length} source link${actions.length === 1 ? '' : 's'} ready for drafting.`"
        />
      </div>
    </header>

    <main class="flex-1 space-y-8 px-4 py-6">
      <section class="space-y-4">
        <div
          v-if="messages.length"
          class="rounded-2xl border border-muted-200/60 bg-background/30 p-4"
        >
          <ChatMessagesList
            :messages="messages"
            :status="status"
          />
        </div>
        <div
          v-else
          class="rounded-2xl border border-dashed border-muted-200/70 bg-muted/20 p-6 text-center text-sm text-muted-500"
        >
          Start chatting with Quillio to see the conversation history here.
        </div>

        <div class="space-y-3">
          <UChatPrompt
            v-model="prompt"
            placeholder="Describe what you need..."
            variant="subtle"
            :disabled="isBusy || promptSubmitting"
            @submit="handlePromptSubmit"
          >
            <UChatPromptSubmit :status="promptSubmitting ? 'submitted' : status" />
          </UChatPrompt>
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
            We'll redirect you to the workspace to finalize the draft.
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
      </section>

      <section class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">
            Workspace drafts
          </h2>
          <UButton
            v-if="loggedIn"
            color="primary"
            variant="outline"
            @click="router.push('/content')"
          >
            View all content
          </UButton>
        </div>

        <div
          v-if="contentsPending"
          class="space-y-2"
        >
          <div class="h-12 rounded-md bg-muted animate-pulse" />
          <div class="h-12 rounded-md bg-muted animate-pulse" />
          <div class="h-12 rounded-md bg-muted animate-pulse" />
        </div>
        <div
          v-else-if="hasContent"
          class="space-y-4"
        >
          <UCard
            v-for="entry in contentEntries"
            :key="entry.id"
            class="flex flex-col gap-3"
          >
            <div class="space-y-1">
              <p class="text-lg font-semibold">
                {{ entry.title }}
              </p>
              <p class="text-xs text-muted-500">
                Updated {{ entry.updatedAt ? entry.updatedAt.toLocaleDateString() : '—' }}
              </p>
            </div>
            <div class="flex flex-wrap gap-3 text-xs text-muted-500">
              <span>{{ entry.sectionsCount }} sections</span>
              <span v-if="entry.wordCount">
                {{ entry.wordCount }} words
              </span>
              <span
                v-if="entry.sourceType"
                class="capitalize"
              >
                Source: {{ entry.sourceType.replaceAll('_', ' ') }}
              </span>
            </div>
            <div class="flex justify-between items-center">
              <div class="flex gap-2">
                <UBadge :color="entry.status === 'published' ? 'primary' : 'neutral'">
                  {{ entry.status }}
                </UBadge>
                <UBadge
                  v-if="entry.contentType"
                  size="xs"
                  variant="soft"
                  class="capitalize"
                >
                  {{ entry.contentType }}
                </UBadge>
              </div>
              <UButton
                size="xs"
                color="primary"
                variant="soft"
                @click="handleOpenDraft(entry)"
              >
                Open draft
              </UButton>
            </div>
          </UCard>
        </div>
        <div
          v-else
          class="rounded-xl border border-dashed border-muted-200/70 bg-muted/20 p-6 text-center text-sm text-muted-500"
        >
          No drafts yet. Turn this conversation into your first piece.
        </div>
      </section>
    </main>
  </div>
</template>
