<script setup lang="ts">
import type { ContentType, ContentTypeOption } from '#shared/constants/contentTypes'
import type { ChatActionSuggestion } from '#shared/utils/types'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { computed, ref, watch } from 'vue'

definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const router = useRouter()
const slug = computed(() => route.params.slug as string)

const {
  messages,
  status,
  actions,
  sources,
  generation,
  errorMessage,
  isBusy,
  activeSourceId,
  selectedContentType,
  sendMessage,
  executeAction
} = useChatSession()

const { data: contents, pending: contentsPending, refresh: refreshContents } = await useFetch(() => '/api/content', {
  key: () => `content-list-${slug.value}`
})

const prompt = ref('')
const activeTab = ref('content')
const loading = ref(false)
const selectedContentId = ref<string | null>('new-draft')

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
      status: entry.content.status,
      updatedAt,
      contentType: entry.currentVersion?.frontmatter?.contentType || entry.content.contentType,
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

function handleContentSelect(contentId: string | null) {
  if (contentId && contentId !== 'new-draft') {
    router.push(`/${slug.value}/content/${contentId}`)
  }
}

const schemaOptions: ContentTypeOption[] = CONTENT_TYPE_OPTIONS
const selectedContentTypeOption = computed(() => {
  return schemaOptions.find((option: ContentTypeOption) => option.value === selectedContentType.value) ?? schemaOptions[0]
})

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
}

const { autoActionBusy } = useChatAutoActions({
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
  if (value?.content?.id) {
    refreshContents()
    router.push(`/${slug.value}/content/${value.content.id}`)
  }
})

watch(() => slug.value, () => {
  refreshContents()
})
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

      <div
        v-if="actions.length"
        class="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 text-sm text-primary-600 dark:text-primary-300 space-y-2"
      >
        <p>
          Detected a {{ actions[0].sourceType?.replace('_', ' ') || 'source' }} link. Draft generation is running automatically.
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
            {{ selectedContentTypeOption.label }}
          </UBadge>
          <USelectMenu
            v-model="selectedContentType"
            :items="schemaOptions"
            value-key="value"
            :icon="selectedContentTypeOption.icon"
            size="xs"
            color="primary"
            variant="ghost"
            class="ml-auto hover:bg-default focus:bg-default data-[state=open]:bg-default"
          />
        </div>
        <p class="text-xs text-muted-500">
          {{ selectedContentTypeOption.description }}
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
  </div>
</template>
