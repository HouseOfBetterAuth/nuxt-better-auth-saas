<script setup lang="ts">
import type { ContentType, ContentTypeOption } from '#shared/constants/contentTypes'
import type { ChatActionSuggestion } from '#shared/utils/types'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { useLocalStorage } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'

definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const slug = computed(() => route.params.slug as string)

const {
  messages,
  status,
  actions,
  sources: _sources,
  generation,
  errorMessage,
  isBusy,
  activeSourceId,
  selectedContentType,
  sendMessage,
  executeAction,
  sessionId,
  sessionContentId,
  createContentFromConversation
} = useChatSession()

const { data: contents, pending: contentsPending, refresh: refreshContents } = await useFetch(() => '/api/content', {
  key: () => `content-list-${slug.value}`
})

const prompt = ref('')
const activeTab = ref('content')
const loading = ref(false)
const selectedContentId = ref<string | undefined>('new-draft')
const isHandlingAction = ref(false)
const isCreateContentModalOpen = ref(false)
const creatingContent = ref(false)
const createContentError = ref<string | null>(null)
const persistedSelections = useLocalStorage<Record<string, string[]>>('chat-selected-message-ids', {})
const selectedMessageIds = ref<string[]>([])
const createContentForm = reactive<{
  title: string
  contentType: ContentType
}>({
  title: '',
  contentType: selectedContentType.value
})

const promptStatus = computed(() => {
  if (loading.value || status.value === 'submitted' || status.value === 'streaming') {
    return loading.value ? 'submitted' : (status.value as 'submitted' | 'streaming')
  }
  if (status.value === 'error') {
    return 'error'
  }
  return 'ready'
})

async function handleSubmit(prompt: string) {
  await sendMessage(prompt)
}

async function handlePromptSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }
  loading.value = true
  try {
    await handleSubmit(trimmed)
    prompt.value = ''
  } finally {
    loading.value = false
  }
}

const contentEntries = computed(() => {
  const list = Array.isArray(contents.value) ? contents.value : []
  return list.map((entry) => {
    const content = entry.content as any
    const sections = Array.isArray(entry.currentVersion?.sections) ? entry.currentVersion.sections : []
    const wordCount = sections.reduce((sum: number, section: Record<string, any>) => {
      const rawValue = typeof section.wordCount === 'string' ? Number.parseInt(section.wordCount, 10) : Number(section.wordCount)
      const safeValue = Number.isFinite(rawValue) ? rawValue : 0
      return sum + safeValue
    }, 0)

    let updatedAt: Date | null = null
    if (content.updatedAt) {
      const parsedDate = new Date(content.updatedAt)
      updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
    }

    return {
      id: content.id,
      title: content.title || 'Untitled draft',
      status: content.status,
      updatedAt,
      contentType: (entry.currentVersion?.frontmatter as any)?.contentType || content.contentType,
      sectionsCount: sections.length,
      wordCount: Number.isFinite(wordCount) ? wordCount : 0,
      sourceType: entry.sourceContent?.sourceType ?? null
    }
  })
})

const rows = computed(() => {
  const dataset = contentEntries.value
  if (activeTab.value === 'archived') {
    return dataset.filter(row => row.status === 'archived')
  }
  return dataset.filter(row => row.status !== 'archived')
})

const hasContent = computed(() => contentEntries.value.length > 0)

interface ContentOption {
  label: string
  value: string
  icon?: string
}

const contentOptions = computed<ContentOption[]>(() => {
  const options: ContentOption[] = [
    { label: 'New Draft', value: 'new-draft', icon: 'i-lucide-file-plus' }
  ]
  if (hasContent.value) {
    const existingContent = contentEntries.value
      .filter(row => row.status !== 'archived')
      .map(row => ({
        label: row.title,
        value: row.id,
        icon: 'i-lucide-file-text'
      }))
    options.push(...existingContent)
  }
  return options
})

const selectedContentOption = computed<ContentOption | undefined>(() => {
  return contentOptions.value.find(option => option.value === selectedContentId.value)
})

function handleContentSelect(contentId: string | undefined) {
  if (contentId && contentId !== 'new-draft') {
    router.push(`/${slug.value}/content/${contentId}`)
  }
}

const schemaOptions: ContentTypeOption[] = CONTENT_TYPE_OPTIONS
const selectedContentTypeOption = computed(() => {
  return schemaOptions.find((option: ContentTypeOption) => option.value === selectedContentType.value) ?? schemaOptions[0]
})

const modalContentTypeOption = computed(() => {
  return schemaOptions.find(option => option.value === createContentForm.contentType)
})

const selectedMessageIdsSet = computed(() => new Set(selectedMessageIds.value))
const transcriptPreview = computed(() => {
  if (!messages.value.length || !selectedMessageIds.value.length) {
    return ''
  }
  const allowed = selectedMessageIdsSet.value
  return messages.value
    .filter(message => allowed.has(message.id))
    .map((message) => {
      const speaker = message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'user'
          ? 'User'
          : 'System'
      return `${speaker}: ${message.content}`
    })
    .join('\n\n')
})
const linkedContent = computed(() => {
  if (!sessionContentId.value) {
    return null
  }
  const dataset = Array.isArray(contentEntries.value) ? contentEntries.value : []
  return dataset.find(entry => entry.id === sessionContentId.value) ?? {
    id: sessionContentId.value,
    title: 'View draft',
    status: null
  }
})
const canCreateContent = computed(() => Boolean(sessionId.value && !sessionContentId.value && selectedMessageIds.value.length >= 1))
const includedMessageCount = computed(() => selectedMessageIds.value.length)

interface QuickChatAction {
  label: string
  icon: string
  contentType: ContentType
  prompt: string
}

const quickChats: QuickChatAction[] = [
  {
    label: 'Recipe blog from video',
    icon: 'i-lucide-cookie',
    contentType: 'recipe',
    prompt: 'Turn the linked video or transcript into a recipe blog that lists ingredients, prep steps, cook times, and a helpful FAQ.'
  },
  {
    label: 'Add FAQ companion',
    icon: 'i-lucide-help-circle',
    contentType: 'faq_page',
    prompt: 'Write an FAQ section that answers the top questions, objections, and troubleshooting tips for this topic.'
  },
  {
    label: 'Outline a mini course',
    icon: 'i-lucide-graduation-cap',
    contentType: 'course',
    prompt: 'Draft a course-style outline with modules, lessons, learning objectives, and key takeaways based on this source.'
  },
  {
    label: 'Step-by-step how-to',
    icon: 'i-lucide-list-checks',
    contentType: 'how_to',
    prompt: 'Create a how-to article with required materials, estimated time, numbered steps, and common pitfalls to avoid.'
  }
]

function handleQuickChat(action: QuickChatAction) {
  selectedContentType.value = action.contentType
  prompt.value = action.prompt
}

async function handleAction(action: ChatActionSuggestion) {
  isHandlingAction.value = true
  try {
    await executeAction(action)

    const contentId = generation.value?.content?.id
    if (contentId && activeSourceId.value) {
      router.push({
        path: `/${slug.value}/content/${contentId}`,
        query: {
          sourceId: activeSourceId.value
        }
      })
    }
  } finally {
    isHandlingAction.value = false
  }
}

const { autoActionBusy: _autoActionBusy } = useChatAutoActions({
  actions,
  isBusy,
  handler: handleAction
})

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(date: Date | null) {
  if (!date) {
    return '—'
  }
  return formatter.format(date)
}

watch(generation, (value) => {
  if (isHandlingAction.value) {
    return
  }
  if (value?.content?.id) {
    refreshContents()
    router.push(`/${slug.value}/content/${value.content.id}`)
  }
})

watch(() => slug.value, () => {
  refreshContents()
})

watch(sessionId, (id) => {
  if (!id) {
    selectedMessageIds.value = []
    return
  }
  const stored = persistedSelections.value?.[id]
  if (Array.isArray(stored) && stored.length) {
    selectedMessageIds.value = stored
  } else {
    const ids = Array.isArray(messages.value) ? messages.value.map(message => message.id) : []
    selectedMessageIds.value = ids
  }
}, { immediate: true })

watch(messages, (list) => {
  const ids = Array.isArray(list) ? list.map(message => message.id) : []
  if (!ids.length) {
    selectedMessageIds.value = []
    return
  }

  const selected = new Set(selectedMessageIds.value)
  let changed = false

  for (const id of ids) {
    if (!selected.has(id)) {
      selected.add(id)
      changed = true
    }
  }

  for (const id of Array.from(selected)) {
    if (!ids.includes(id)) {
      selected.delete(id)
      changed = true
    }
  }

  if (changed) {
    selectedMessageIds.value = Array.from(selected)
  }
}, { immediate: true, deep: true })

watch(selectedMessageIds, (ids) => {
  const id = sessionId.value
  if (!id) {
    return
  }
  persistedSelections.value = {
    ...persistedSelections.value,
    [id]: ids
  }
}, { deep: true })

watch(selectedContentType, (value) => {
  if (!isCreateContentModalOpen.value) {
    createContentForm.contentType = value
  }
})

watch(() => isCreateContentModalOpen.value, (isOpen) => {
  if (!isOpen) {
    createContentError.value = null
  }
})

function openCreateContentModal() {
  createContentForm.contentType = selectedContentType.value
  if (!createContentForm.title) {
    createContentForm.title = ''
  }
  createContentError.value = null
  isCreateContentModalOpen.value = true
}

function resetCreateContentForm() {
  createContentForm.title = ''
  createContentForm.contentType = selectedContentType.value
}

function toggleMessageSelection(messageId: string, include: boolean) {
  const current = new Set(selectedMessageIds.value)
  if (include) {
    current.add(messageId)
  } else {
    current.delete(messageId)
  }
  selectedMessageIds.value = Array.from(current)
}

async function handleCreateContentSubmit() {
  const trimmedTitle = createContentForm.title.trim()
  if (!trimmedTitle) {
    createContentError.value = 'Add a working title for this draft.'
    return
  }

  if (!sessionId.value) {
    createContentError.value = 'Start a conversation before creating content.'
    return
  }

  creatingContent.value = true
  createContentError.value = null
  try {
    const response = await createContentFromConversation({
      title: trimmedTitle,
      contentType: createContentForm.contentType,
      messageIds: selectedMessageIds.value
    })

    toast.add({
      title: 'Draft created',
      description: 'Opened your conversation as a structured draft.',
      color: 'primary'
    })

    isCreateContentModalOpen.value = false
    resetCreateContentForm()
    await refreshContents()

    const createdId = response?.content?.id
    if (createdId) {
      router.push(`/${slug.value}/content/${createdId}`)
    }
  } catch (error: any) {
    const message = error?.data?.statusMessage || error?.data?.message || error?.message || 'Failed to create a draft from this conversation.'
    createContentError.value = message
    toast.add({
      title: 'Unable to create draft',
      description: message,
      color: 'error'
    })
  } finally {
    creatingContent.value = false
  }
}
</script>

<template>
  <div class="flex flex-col justify-center gap-4 sm:gap-6 py-8">
    <UContainer class="space-y-4">
      <div class="text-center">
        <h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
          What should we write next?
        </h1>
      </div>

      <div v-if="errorMessage">
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
        />
      </div>

      <UChatPrompt
        v-model="prompt"
        placeholder="Ask anything…"
        variant="subtle"
        class="[view-transition-name:chat-prompt]"
        :disabled="isBusy || loading"
        @submit="handlePromptSubmit"
      >
        <UChatPromptSubmit :status="promptStatus" />
        <template
          v-if="contentOptions.length > 0"
          #footer
        >
          <USelectMenu
            v-model="selectedContentId"
            :items="contentOptions"
            :icon="selectedContentOption?.icon ?? 'i-lucide-file-plus'"
            variant="ghost"
            value-key="value"
            class="hover:bg-default focus:bg-default data-[state=open]:bg-default"
            :ui="{
              trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
            }"
            @update:model-value="handleContentSelect"
          />
        </template>
      </UChatPrompt>

      <UCard
        v-if="messages.length"
        :ui="{ body: 'space-y-4' }"
        class="shadow-none border border-dashed border-muted-200/70"
      >
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm text-muted-500">
                Conversation history
              </p>
              <p class="text-lg font-semibold">
                {{ messages.length }} message{{ messages.length === 1 ? '' : 's' }}
              </p>
            </div>
            <UBadge
              size="sm"
              variant="soft"
              :color="sessionContentId ? 'neutral' : 'primary'"
            >
              <template v-if="sessionContentId">
                Linked to draft
              </template>
              <template v-else>
                {{ includedMessageCount }} included
              </template>
            </UBadge>
          </div>
          <div
            v-if="linkedContent"
            class="flex items-center justify-between gap-3 rounded-md border border-muted-200/80 bg-background/60 px-3 py-2 text-sm"
          >
            <div class="flex flex-col">
              <span class="text-xs uppercase tracking-wide text-muted-500">
                Linked draft
              </span>
              <NuxtLink
                class="font-medium text-primary-600 hover:underline"
                :to="`/${slug}/content/${linkedContent.id}`"
              >
                {{ linkedContent.title || 'View draft' }}
              </NuxtLink>
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-rotate-cw"
              @click="toast.add({
                title: 'Sync coming soon',
                description: 'Resyncing chat instructions into linked drafts will be available shortly.',
                color: 'neutral'
              })"
            >
              Sync coming soon
            </UButton>
          </div>
        </template>

        <div class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
          <div
            v-for="message in messages"
            :key="message.id"
            class="rounded-lg border border-muted-200/60 bg-background/60 p-3"
          >
            <UCheckbox
              :model-value="selectedMessageIdsSet.has(message.id)"
              :disabled="creatingContent"
              @update:model-value="value => toggleMessageSelection(message.id, Boolean(value))"
            >
              <template #label>
                <div class="space-y-1 text-left">
                  <p class="text-xs uppercase tracking-wide text-muted-500">
                    {{ message.role === 'assistant' ? 'Assistant' : 'You' }}
                  </p>
                  <p class="text-sm text-muted-700 whitespace-pre-wrap leading-relaxed">
                    {{ message.content }}
                  </p>
                </div>
              </template>
            </UCheckbox>
          </div>
        </div>
        <div class="text-xs text-muted-500 space-y-2">
          <p>
            Selected messages feed into draft creation so you can exclude small talk or unrelated steps.
          </p>
          <UAccordion
            v-if="transcriptPreview"
            size="xs"
            :items="[{ label: 'Preview transcript sent to Codex', value: 'transcript', content: '' }]"
          >
            <template #content>
              <UTextarea
                :model-value="transcriptPreview"
                readonly
                autoresize
                class="text-xs"
              />
            </template>
          </UAccordion>
        </div>
      </UCard>

      <div
        v-if="canCreateContent"
        class="flex justify-end"
      >
        <UButton
          icon="i-lucide-wand-2"
          color="primary"
          variant="soft"
          size="sm"
          :disabled="isBusy || loading"
          @click="openCreateContentModal"
        >
          Create draft from chat
        </UButton>
      </div>

      <div
        v-if="actions.length"
        class="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 text-sm text-primary-600 dark:text-primary-300 space-y-2"
      >
        <p>
          Detected a {{ actions[0]?.sourceType?.replace('_', ' ') || 'source' }} link. Draft generation is running automatically.
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="action in actions"
            :key="`${action.type}-${action.sourceContentId || action.label || 'action'}`"
            size="xs"
            color="primary"
            variant="ghost"
            :disabled="isBusy || loading"
            :loading="isBusy"
            @click="handleAction(action)"
          >
            Run again
          </UButton>
        </div>
      </div>

      <div class="rounded-2xl border border-muted-200/60 bg-background/30 p-4 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm text-muted-500">
            Structured schema focus
          </span>
          <UBadge
            color="neutral"
            variant="soft"
            size="sm"
            class="capitalize"
          >
            {{ selectedContentTypeOption?.label || 'Unknown' }}
          </UBadge>
          <USelectMenu
            v-model="selectedContentType"
            :items="schemaOptions"
            value-key="value"
            :icon="selectedContentTypeOption?.icon || 'i-lucide-file-text'"
            size="xs"
            color="primary"
            variant="ghost"
            class="ml-auto hover:bg-default focus:bg-default data-[state=open]:bg-default"
          />
        </div>
        <p class="text-xs text-muted-500">
          {{ selectedContentTypeOption?.description || 'No description available' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="quickChat in quickChats"
            :key="quickChat.label"
            :icon="quickChat.icon"
            :label="quickChat.label"
            size="sm"
            color="neutral"
            variant="outline"
            class="rounded-full"
            :disabled="isBusy || loading"
            @click="handleQuickChat(quickChat)"
          />
        </div>
      </div>
    </UContainer>

    <UContainer
      v-if="contentsPending || hasContent"
      class="space-y-4"
    >
      <UTabs
        v-model="activeTab"
        :content="false"
        variant="link"
        :items="[
          { label: 'Content', value: 'content' },
          { label: 'Archived', value: 'archived' }
        ]"
      />

      <div
        v-if="contentsPending"
        class="space-y-2"
      >
        <div class="h-12 rounded-md bg-muted animate-pulse" />
        <div class="h-12 rounded-md bg-muted animate-pulse" />
        <div class="h-12 rounded-md bg-muted animate-pulse" />
      </div>
      <div
        v-else-if="rows.length"
        class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        <UCard
          v-for="row in rows"
          :key="row.id"
          class="flex flex-col gap-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <NuxtLink
                class="text-lg font-semibold text-highlighted hover:underline"
                :to="`/${slug}/content/${row.id}`"
              >
                {{ row.title }}
              </NuxtLink>
              <p class="text-xs text-muted-500">
                Updated {{ formatDate(row.updatedAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1 justify-end">
              <UBadge :color="row.status === 'published' ? 'primary' : 'neutral'">
                {{ row.status }}
              </UBadge>
              <UBadge
                v-if="row.contentType"
                size="xs"
                variant="soft"
                class="capitalize"
              >
                {{ row.contentType }}
              </UBadge>
            </div>
          </div>
          <div class="flex flex-wrap gap-4 text-xs text-muted-500">
            <span>{{ row.sectionsCount }} sections</span>
            <span v-if="row.wordCount">
              {{ row.wordCount }} words
            </span>
            <span
              v-if="row.sourceType"
              class="capitalize"
            >
              Source:
              {{ typeof row.sourceType === 'string' ? row.sourceType.replace('_', ' ') : String(row.sourceType).replace('_', ' ') }}
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              :to="`/${slug}/content/${row.id}`"
            >
              Open draft
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="isBusy || loading"
              @click="handleContentSelect(row.id)"
            >
              Continue chat
            </UButton>
          </div>
        </UCard>
      </div>
      <div
        v-else
        class="rounded-xl border border-dashed border-muted-200/70 bg-muted/20 p-6 text-center text-sm text-muted-500"
      >
        No drafts yet. Share a source link or describe what to write to generate your first piece.
      </div>
    </UContainer>

    <UModal v-model:open="isCreateContentModalOpen">
      <UCard>
        <template #header>
          <div>
            <p class="text-lg font-semibold">
              Create a draft from this chat
            </p>
            <p class="text-sm text-muted-500">
              Save the current conversation as structured content and continue refining it in the editor.
            </p>
          </div>
        </template>

        <div class="space-y-4">
          <div class="space-y-2">
            <label
              for="draft-title"
              class="text-xs uppercase tracking-wide text-muted-500"
            >
              Working title
            </label>
            <UInput
              id="draft-title"
              v-model="createContentForm.title"
              placeholder="e.g. AI Agent onboarding guide"
            />
          </div>
          <div class="space-y-2">
            <label
              for="draft-content-type"
              class="text-xs uppercase tracking-wide text-muted-500"
            >
              Content type
            </label>
            <USelectMenu
              id="draft-content-type"
              v-model="createContentForm.contentType"
              :items="schemaOptions"
              value-key="value"
              :icon="modalContentTypeOption?.icon || 'i-lucide-file-text'"
            />
          </div>
          <p class="text-xs text-muted-500">
            {{ includedMessageCount }} message{{ includedMessageCount === 1 ? '' : 's' }} will be included. Update selections above before creating the draft.
          </p>
          <UAlert
            v-if="createContentError"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :description="createContentError"
          />
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              @click="isCreateContentModalOpen = false"
            >
              Cancel
            </UButton>
            <UButton
              color="primary"
              size="sm"
              :loading="creatingContent"
              @click="handleCreateContentSubmit"
            >
              Create draft
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
