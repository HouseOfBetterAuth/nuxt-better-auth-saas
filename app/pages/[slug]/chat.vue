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
  actions,
  status,
  errorMessage,
  generation,
  sendMessage,
  executeAction,
  isBusy,
  selectedContentType
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

const columns = [
  { id: 'title', key: 'title', label: 'Title' },
  { id: 'status', key: 'status', label: 'Status' },
  { id: 'updatedAt', key: 'updatedAt', label: 'Last updated' }
]

const allRows = computed(() => (contents.value || []).map(entry => ({
  id: entry.content.id,
  title: entry.content.title || 'Untitled draft',
  status: entry.content.status,
  updatedAt: entry.content.updatedAt ? new Date(entry.content.updatedAt) : null
})))

const rows = computed(() => {
  if (activeTab.value === 'archived') {
    return allRows.value.filter(row => row.status === 'archived')
  }
  return allRows.value.filter(row => row.status !== 'archived')
})

const hasContent = computed(() => {
  return contents.value && Array.isArray(contents.value) && contents.value.length > 0
})

const contentOptions = computed(() => {
  const options = [
    { label: 'New Draft', value: 'new-draft', icon: 'i-lucide-file-plus' }
  ]
  if (hasContent.value) {
    const existingContent = allRows.value
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

const autoActionKey = ref<string | null>(null)

async function handleAction(action: ChatActionSuggestion) {
  await executeAction(action)
}

if (import.meta.client) {
  watch(actions, async (newActions) => {
    if (!newActions?.length) {
      autoActionKey.value = null
      return
    }

    if (isBusy.value) {
      return
    }

    const autoAction = newActions.find(action => action.type === 'suggest_generate_from_source')
    if (!autoAction) {
      return
    }

    const key = `${autoAction.type}:${autoAction.sourceContentId ?? autoAction.label ?? 'auto'}`
    if (autoActionKey.value === key) {
      return
    }

    autoActionKey.value = key
    try {
      await handleAction(autoAction)
    } catch (error) {
      console.error('Automatic action execution failed', error)
    }
  }, { deep: true })
}

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
            :icon="contentOptions.find((opt: any) => opt.value === selectedContentId)?.icon || 'i-lucide-file-plus'"
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
        class="overflow-x-auto"
      >
        <UTable
          :rows="rows"
          :columns="columns"
        >
          <template #title-data="{ row }">
            <NuxtLink
              class="text-primary hover:underline"
              :to="`/${slug}/content/${row.id}`"
            >
              {{ row.title }}
            </NuxtLink>
          </template>
          <template #status-data="{ row }">
            <UBadge :color="row.status === 'published' ? 'primary' : 'neutral'">
              {{ row.status }}
            </UBadge>
          </template>
          <template #updatedAt-data="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </UTable>
      </div>
    </UContainer>
  </div>
</template>
