<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

type ContentStatus = 'draft' | 'published' | 'archived' | 'generating' | 'error' | 'loading'

interface ContentVersionSection {
  id: string
  title: string
  body?: string
  body_mdx?: string
  wordCount?: number
  index?: number
  type?: string
  meta?: Record<string, any>
  level?: number
  anchor?: string
  summary?: string | null
}

interface ContentVersion {
  id: string
  bodyMdx?: string
  bodyHtml?: string
  frontmatter?: Record<string, any>
  version?: number
  updatedAt?: string
  createdByUserId?: string
  diffStats?: {
    additions?: number
    deletions?: number
  }
  assets?: {
    generator?: {
      engine?: string
      generatedAt?: string
      stages?: string[]
    }
  }
  sections?: ContentVersionSection[]
  seoSnapshot?: Record<string, any>
}

interface SourceContent {
  id: string
  sourceType: string
  externalId?: string
  sourceText?: string
  sourceUrl?: string
  ingestStatus?: 'pending' | 'ingested' | 'failed'
  metadata?: {
    duration?: number
    [key: string]: any
  }
  createdAt: string | Date
}

interface ContentEntity {
  id: string
  title?: string
  status?: ContentStatus
  sourceContent?: SourceContent | null
  updatedAt?: string
  createdByUserId?: string
  metadata?: Record<string, any>
}

interface ContentChatSession {
  id: string
  status?: string | null
  sourceContentId?: string | null
  metadata?: Record<string, any> | null
}

interface ContentChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

interface ContentChatLog {
  id: string
  type: string
  message: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

interface ContentResponse {
  content: ContentEntity
  currentVersion?: ContentVersion | null
  sourceContent?: SourceContent | null
  chatSession?: ContentChatSession | null
  chatMessages?: ContentChatMessage[] | null
  chatLogs?: ContentChatLog[] | null
}

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface ChatSubmissionResponse {
  assistantMessage?: string | null
}

interface ChatLayoutHeroState {
  title: string
  contentType?: string | null
  updatedAtLabel?: string | null
  status?: ContentStatus
  additions?: number
  deletions?: number
}

const props = withDefaults(defineProps<{
  contentId: string
  organizationSlug?: string | null
  backTo?: string | null
  showBackButton?: boolean
  initialPayload?: ContentResponse | null
}>(), {
  showBackButton: true,
  initialPayload: null
})
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'ready'): void
}>()

const currentRoute = useRoute()
const router = useRouter()
const slug = computed(() => props.organizationSlug ?? (currentRoute.params.slug as string | undefined) ?? null)
const contentId = computed(() => props.contentId ?? (currentRoute.params.id as string))
const showBackButton = computed(() => props.showBackButton !== false)
const backRoute = computed(() => {
  if (props.backTo !== undefined) {
    return props.backTo
  }
  return slug.value ? `/${slug.value}/chat` : null
})

function handleBackNavigation() {
  if (backRoute.value) {
    router.push(backRoute.value)
    return
  }
  emit('close')
}

const prompt = ref('')
const loading = ref(false)
const toast = useToast()
const conversationMessages = ref<ChatMessage[]>([])
const chatStatus = ref<ChatStatus>('ready')
const chatErrorMessage = ref<string | null>(null)
const layoutHero = useState<ChatLayoutHeroState | null>('chat/layoutHero', () => null)

const content = ref<ContentResponse | null>(props.initialPayload ?? null)
const pending = ref(!content.value)
const error = ref<any>(null)
const readyEmitted = ref(false)

const emitReady = () => {
  if (!readyEmitted.value) {
    emit('ready')
    readyEmitted.value = true
  }
}

async function loadWorkspacePayload() {
  if (!contentId.value) {
    content.value = null
    return
  }
  pending.value = true
  error.value = null
  try {
    const response = await $fetch<{ workspace: ContentResponse | null }>('/api/chat/workspace', {
      query: { contentId: contentId.value }
    })
    content.value = response.workspace ?? null
    emitReady()
  } catch (err: any) {
    error.value = err
  } finally {
    pending.value = false
  }
}

if (content.value) {
  pending.value = false
  emitReady()
} else {
  await loadWorkspacePayload()
}

watch(() => props.initialPayload, (value) => {
  if (value && value.content.id === contentId.value) {
    content.value = value
    pending.value = false
    emitReady()
  }
})

watch(() => contentId.value, async (next, prev) => {
  if (next === prev) {
    return
  }
  readyEmitted.value = false
  if (props.initialPayload && props.initialPayload.content.id === next) {
    content.value = props.initialPayload
    pending.value = false
    emitReady()
    return
  }
  await loadWorkspacePayload()
})

const contentRecord = computed(() => content.value?.content ?? null)
const currentVersion = computed(() => content.value?.currentVersion ?? null)
const sourceDetails = computed<SourceContent | null>(() => content.value?.sourceContent ?? null)
const chatLogs = computed(() => content.value?.chatLogs ?? [])

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function toDate(value: string | Date) {
  if (value instanceof Date) {
    return value
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

watch(content, (value) => {
  const chatMessages = value?.chatMessages ?? []
  if (!Array.isArray(chatMessages)) {
    conversationMessages.value = []
    return
  }
  conversationMessages.value = chatMessages
    .filter((message): message is ContentChatMessage => Boolean(message))
    .map(message => ({
      id: message.id,
      role: ['user', 'system', 'assistant'].includes(message.role) ? message.role : 'assistant',
      content: message.content,
      createdAt: toDate(message.createdAt),
      payload: message.payload ?? null
    }))
}, { immediate: true })

const title = computed(() => contentRecord.value?.title || 'Untitled draft')
const contentStatus = computed<ContentStatus>(() => (contentRecord.value?.status as ContentStatus) || 'draft')
const isPublished = computed(() => contentStatus.value === 'published')
const generatedContent = computed(() => currentVersion.value?.bodyMdx || currentVersion.value?.bodyHtml || null)
const hasGeneratedContent = computed(() => !!generatedContent.value)
const frontmatter = computed(() => currentVersion.value?.frontmatter || null)
const contentDisplayTitle = computed(() => frontmatter.value?.seoTitle || frontmatter.value?.title || title.value)
const _assets = computed(() => currentVersion.value?.assets || null)
const seoSnapshot = computed(() => currentVersion.value?.seoSnapshot || null)

const sections = computed(() => {
  const sectionsData = currentVersion.value?.sections
  if (!Array.isArray(sectionsData)) {
    return []
  }

  return sectionsData.map((section: Record<string, any>, idx: number) => {
    const body = typeof section.body_mdx === 'string'
      ? section.body_mdx
      : typeof section.body === 'string'
        ? section.body
        : ''

    return {
      ...section,
      id: section.id || section.section_id || `section-${idx}`,
      index: Number.isFinite(section.index) ? section.index : idx,
      title: section.title || `Section ${idx + 1}`,
      type: section.type || section.meta?.planType || 'body',
      level: section.level || 2,
      anchor: section.anchor || slugify(section.title || `section-${idx}`),
      wordCount: Number.isFinite(section.wordCount)
        ? section.wordCount
        : body.split(/\s+/).filter(Boolean).length,
      summary: section.summary || section.meta?.summary || null,
      body
    }
  }).sort((a, b) => a.index - b.index)
})

// Date formatting utilities (must be declared before computed properties)
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return '—'
  }

  const date = typeof value === 'string' ? new Date(value) : value
  if (!date || Number.isNaN(date.getTime())) {
    return '—'
  }

  return dateFormatter.format(date)
}

const _totalWordCount = computed(() => sections.value.reduce((sum, section) => sum + (section.wordCount || 0), 0))
const contentUpdatedAtLabel = computed(() => {
  const value = contentRecord.value?.updatedAt
  return value ? formatDate(value) : '—'
})

const _sourceLink = computed(() => {
  const metadata = sourceDetails.value?.metadata as Record<string, any> | null
  if (metadata && typeof metadata.originalUrl === 'string') {
    return metadata.originalUrl
  }
  if (sourceDetails.value?.sourceType === 'youtube' && sourceDetails.value?.externalId) {
    return `https://www.youtube.com/watch?v=${sourceDetails.value.externalId}`
  }
  return null
})

const seoPlan = computed(() => {
  const snapshot = seoSnapshot.value
  const plan = snapshot && typeof snapshot === 'object' ? snapshot.plan : null
  return plan && typeof plan === 'object' ? plan : null
})

const _seoKeywords = computed(() => {
  const planKeywords = seoPlan.value?.keywords
  if (Array.isArray(planKeywords)) {
    return planKeywords.filter(keyword => typeof keyword === 'string' && keyword.trim().length > 0)
  }
  return []
})

const publicContentUrl = computed(() => {
  if (!frontmatter.value?.slug) {
    return null
  }
  return `/${frontmatter.value.slug}`
})

const primaryActionLabel = computed(() => (isPublished.value ? 'View' : 'Publish'))
const primaryActionColor = computed(() => (isPublished.value ? 'primary' : 'success'))
const diffStats = computed(() => {
  const versionStats = currentVersion.value?.diffStats
  const fmStats = frontmatter.value?.diffStats as { additions?: number, deletions?: number } | undefined
  const additions = Number(versionStats?.additions ?? fmStats?.additions ?? 0)
  const deletions = Number(versionStats?.deletions ?? fmStats?.deletions ?? 0)
  return {
    additions: Number.isFinite(additions) ? additions : 0,
    deletions: Number.isFinite(deletions) ? deletions : 0
  }
})

const heroPayload = computed<ChatLayoutHeroState | null>(() => {
  if (!contentRecord.value) {
    return null
  }
  return {
    title: contentDisplayTitle.value,
    contentType: frontmatter.value?.contentType || 'content',
    updatedAtLabel: contentUpdatedAtLabel.value,
    status: contentStatus.value,
    additions: diffStats.value.additions,
    deletions: diffStats.value.deletions
  }
})

watch(heroPayload, (value) => {
  layoutHero.value = value
}, { immediate: true })

type ViewTabValue = 'conversation' | 'diff' | 'logs'
const viewTabs: { label: string, value: ViewTabValue }[] = [
  { label: 'Conversation', value: 'conversation' },
  { label: 'Diff', value: 'diff' },
  { label: 'Logs', value: 'logs' }
]

const activeViewTab = ref<ViewTabValue>('conversation')

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sectionPreview(body: string, limit = 320) {
  if (!body) {
    return ''
  }
  if (body.length <= limit) {
    return body
  }
  return `${body.slice(0, limit)}…`
}

const selectedSectionId = ref<string | null>(null)
const selectedSection = computed(() => sections.value.find(section => section.id === selectedSectionId.value) ?? null)
const _showFullTranscript = ref(false)
const _formattedTranscript = computed(() => formatTranscriptText(sourceDetails.value?.sourceText ?? ''))

// Processing state
const _isProcessing = computed(() => {
  if (!sourceDetails.value)
    return false
  return sourceDetails.value.ingestStatus === 'pending' || contentStatus.value === 'generating'
})

const _processingStatusText = computed(() => {
  if (sourceDetails.value?.ingestStatus === 'pending')
    return 'Processing source content...'
  if (contentStatus.value === 'generating')
    return 'Generating content...'
  return 'Processing...'
})

const _processingProgress = computed(() => {
  // This could be enhanced with actual progress from the API
  return sourceDetails.value?.ingestStatus === 'ingested' ? 100 : 50
})

const _processingStatusColor = computed(() => {
  if (contentStatus.value === 'error')
    return 'error'
  if (sourceDetails.value?.ingestStatus === 'ingested')
    return 'success'
  return 'primary'
})

// Helper methods
function _getStatusColor(status?: string) {
  switch (status) {
    case 'ingested':
      return 'success' // Changed from 'green'
    case 'pending':
      return 'warning' // Changed from 'yellow'
    case 'failed':
      return 'error' // Changed from 'red'
    default:
      return 'neutral' // Changed from 'gray'
  }
}

function _formatStatus(status?: string) {
  if (!status)
    return 'Unknown'
  return status.replace(/_/g, ' ')
}

function _formatSourceType(type?: string | null) {
  if (!type)
    return '—'
  return type
    .toString()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function _formatDuration(seconds: number) {
  if (seconds == null || !Number.isFinite(seconds))
    return '—'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatTranscriptText(raw: string) {
  if (!raw) {
    return ''
  }

  let cleaned = raw
    .replace(/Kind:\s*captions\s*Language:\s*\w+/i, ' ')
    .replace(/<\d{2}:\d{2}:\d{2}(?:\.\d+)?>/g, ' ')
    .replace(/<\/c>/gi, ' ')
    .replace(/<c>/gi, ' ')

  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return ''
  }

  const segments = cleaned
    .split(/(?<=[.!?])\s+/)
    .map(segment => segment.trim())
    .filter(Boolean)

  if (!segments.length) {
    return cleaned
  }

  const deduped: string[] = []
  for (const segment of segments) {
    if (deduped[deduped.length - 1] !== segment) {
      deduped.push(segment)
    }
  }

  return deduped.join('\n\n')
}

const sectionSelectOptions = computed(() => sections.value.map(section => ({
  label: section.title,
  value: section.id,
  description: `${section.wordCount} words`,
  icon: 'i-lucide-align-left'
})))

watch(sections, (list) => {
  if (!list.length) {
    selectedSectionId.value = null
    return
  }

  if (!selectedSectionId.value || !list.some(section => section.id === selectedSectionId.value)) {
    selectedSectionId.value = list[0]?.id ?? null
  }
}, { immediate: true })

function focusSection(sectionId: string) {
  selectedSectionId.value = sectionId

  // Scroll to the section element
  nextTick(() => {
    const element = document.getElementById(`section-${sectionId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}

const _promptStatus = computed(() => {
  if (loading.value || chatStatus.value === 'submitted' || chatStatus.value === 'streaming') {
    return loading.value ? 'submitted' : (chatStatus.value as 'submitted' | 'streaming')
  }
  if (chatStatus.value === 'error') {
    return 'error'
  }
  return 'ready'
})

async function _handleSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }
  if (!selectedSectionId.value) {
    return
  }
  loading.value = true
  chatStatus.value = 'submitted'
  chatErrorMessage.value = null

  const userMessage: ChatMessage = {
    id: createMessageId(),
    role: 'user',
    content: trimmed,
    createdAt: new Date()
  }
  conversationMessages.value = [
    ...conversationMessages.value,
    userMessage
  ]

  try {
    const response = await $fetch<ChatSubmissionResponse>('/api/chat', {
      method: 'POST',
      body: {
        message: trimmed,
        action: {
          type: 'patch_section',
          contentId: contentId.value,
          sectionId: selectedSectionId.value,
          sectionTitle: selectedSection.value?.title ?? null
        }
      }
    })

    prompt.value = ''

    if (response?.assistantMessage) {
      conversationMessages.value = [
        ...conversationMessages.value,
        {
          id: createMessageId(),
          role: 'assistant',
          content: response.assistantMessage,
          createdAt: new Date()
        }
      ]
    }

    chatStatus.value = 'ready'
    await loadWorkspacePayload()
  } catch (error: any) {
    chatStatus.value = 'error'
    chatErrorMessage.value = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to send that message.'
  } finally {
    loading.value = false
  }
}

function handlePrimaryAction() {
  if (isPublished.value) {
    if (publicContentUrl.value) {
      router.push(publicContentUrl.value)
      return
    }
    toast.add({
      title: 'Missing slug',
      description: 'Cannot open published page without a slug.',
      color: 'warning'
    })
    return
  }

  toast.add({
    title: 'Publish action pending',
    description: 'Publishing workflow is not wired yet. Add flow when ready.',
    color: 'neutral'
  })
}

function handleArchive() {
  toast.add({
    title: 'Archive coming soon',
    description: 'Archiving workflow is not implemented yet.',
    color: 'neutral'
  })
}

function handleShare() {
  toast.add({
    title: 'Share workflow pending',
    description: 'Sharing workflow is not implemented yet.',
    color: 'neutral'
  })
}

onBeforeUnmount(() => {
  layoutHero.value = null
})
</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-muted-200/60 bg-muted/10 px-4 py-3">
      <div class="flex items-center gap-3 min-w-0">
        <UButton
          v-if="showBackButton"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
          class="shrink-0"
          @click="handleBackNavigation"
        />
        <div class="min-w-0">
          <p class="text-sm text-muted-500">
            {{ frontmatter?.contentType || 'content' }} • {{ contentUpdatedAtLabel }}
          </p>
          <p class="text-lg font-semibold truncate">
            {{ contentDisplayTitle }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          v-if="diffStats.additions || diffStats.deletions"
          variant="soft"
          size="sm"
        >
          +{{ diffStats.additions }} / -{{ diffStats.deletions }}
        </UBadge>
        <UButton
          icon="i-lucide-archive"
          variant="ghost"
          size="sm"
          @click="handleArchive"
        >
          Archive
        </UButton>
        <UButton
          icon="i-lucide-share-2"
          variant="ghost"
          size="sm"
          @click="handleShare"
        >
          Share
        </UButton>
        <UButton
          :color="primaryActionColor"
          size="sm"
          :disabled="!isPublished && pending"
          @click="handlePrimaryAction"
        >
          {{ primaryActionLabel }}
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="chatErrorMessage"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="chatErrorMessage"
    />

    <div class="grid gap-6 lg:grid-cols-[320px,1fr]">
      <aside class="space-y-4">
        <UCard>
          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between text-xs uppercase tracking-wide text-muted-500">
              <span>Status</span>
              <UBadge
                size="xs"
                class="capitalize"
              >
                {{ contentStatus }}
              </UBadge>
            </div>
            <p class="font-medium">
              {{ title }}
            </p>
            <p class="text-xs text-muted-500">
              {{ contentUpdatedAtLabel }}
            </p>
            <div
              v-if="_sourceLink"
              class="text-xs text-primary-500"
            >
              <NuxtLink
                :href="_sourceLink"
                target="_blank"
              >
                View source
              </NuxtLink>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="text-sm font-semibold">
              Section tools
            </div>
          </template>
          <div class="space-y-3">
            <USelectMenu
              v-model="selectedSectionId"
              :items="sectionSelectOptions"
              value-key="value"
              placeholder="Select a section…"
            />
            <p
              v-if="selectedSection"
              class="text-xs text-muted-500"
            >
              {{ selectedSection.wordCount }} words · {{ selectedSection.type }}
            </p>
            <div class="flex gap-2">
              <UButton
                v-if="selectedSection"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-edit-3"
                @click="focusSection(selectedSection.id)"
              >
                Jump to section
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <p class="text-sm font-semibold">
              Activity
            </p>
          </template>
          <div
            v-if="chatLogs.length"
            class="space-y-3"
          >
            <div
              v-for="log in chatLogs.slice(0, 4)"
              :key="log.id"
              class="rounded-lg border border-muted-200/60 px-3 py-2"
            >
              <div class="flex items-center justify-between text-xs text-muted-500">
                <span class="capitalize">
                  {{ log.type.replace(/_/g, ' ') }}
                </span>
                <span>{{ formatDate(log.createdAt) }}</span>
              </div>
              <p class="text-sm mt-1">
                {{ log.message }}
              </p>
            </div>
            <NuxtLink
              v-if="chatLogs.length > 4"
              to="#logs"
              class="text-xs text-primary-500"
            >
              View all logs
            </NuxtLink>
          </div>
          <p
            v-else
            class="text-xs text-muted-500"
          >
            No activity yet.
          </p>
        </UCard>
      </aside>

      <section class="space-y-4">
        <UTabs
          v-model="activeViewTab"
          :items="viewTabs"
          size="sm"
          :content="false"
          class="w-full"
        />

        <div
          v-if="activeViewTab === 'conversation'"
          class="space-y-4"
        >
          <UCard
            v-if="sections.length"
            class="divide-y divide-muted-200/60"
          >
            <div
              v-for="section in sections"
              :id="`section-${section.id}`"
              :key="section.id"
              class="space-y-2 py-4"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="font-semibold">
                    {{ section.title }}
                  </p>
                  <p class="text-xs uppercase tracking-wide text-muted-500">
                    H{{ section.level }} • {{ section.wordCount }} words
                  </p>
                </div>
                <UBadge
                  color="neutral"
                  size="xs"
                  class="capitalize"
                >
                  {{ section.type }}
                </UBadge>
              </div>
              <p
                v-if="section.summary"
                class="text-sm text-muted-500"
              >
                {{ section.summary }}
              </p>
              <p class="text-sm text-muted-600 whitespace-pre-line">
                {{ sectionPreview(section.body) }}
              </p>
            </div>
          </UCard>
          <UAlert
            v-else
            color="neutral"
            variant="soft"
            icon="i-lucide-info"
            description="Sections will appear once the draft is generated."
          />
        </div>

        <div
          v-else-if="activeViewTab === 'diff'"
          class="space-y-4"
        >
          <UCard v-if="hasGeneratedContent">
            <template #header>
              <div class="flex items-center justify-between">
                <p class="text-lg font-semibold">
                  Draft body (MDX)
                </p>
                <UBadge
                  v-if="currentVersion?.version"
                  size="sm"
                  variant="soft"
                >
                  v{{ currentVersion.version }}
                </UBadge>
              </div>
            </template>
            <pre class="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md overflow-x-auto">
{{ generatedContent }}
            </pre>
          </UCard>
          <UAlert
            v-else
            color="neutral"
            variant="soft"
            icon="i-lucide-info"
            description="No diff output yet."
          />
        </div>

        <div
          v-else
          id="logs"
          class="space-y-4"
        >
          <div
            v-if="!chatLogs.length"
            class="rounded-xl border border-dashed border-muted-200/70 bg-muted/30 p-4 text-sm text-muted-500 text-center"
          >
            No chat activity recorded yet.
          </div>
          <UCard
            v-else
            :ui="{ body: 'p-0' }"
          >
            <ul class="divide-y divide-muted-200/60">
              <li
                v-for="log in chatLogs"
                :key="log.id"
                class="p-4 space-y-1"
              >
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-500">
                  <span>{{ log.type.replace(/_/g, ' ') }}</span>
                  <span class="normal-case">
                    {{ formatDate(log.createdAt) }}
                  </span>
                </div>
                <p class="text-sm text-muted-700 dark:text-muted-200">
                  {{ log.message }}
                </p>
              </li>
            </ul>
          </UCard>
        </div>
      </section>
    </div>

    <div class="space-y-4">
      <UCard>
        <template #header>
          <div class="text-sm font-semibold">
            Draft conversation
          </div>
        </template>
        <div
          v-if="conversationMessages.length > 0"
          class="max-h-[460px] overflow-y-auto pr-1"
        >
          <ChatMessagesList
            :messages="conversationMessages"
            :status="chatStatus"
          />
        </div>
        <div
          v-else
          class="text-sm text-muted-500"
        >
          No chat history yet. Send instructions to start iterating on this section.
        </div>
      </UCard>

      <UCard class="space-y-3">
        <p class="text-sm font-semibold">
          Request changes
        </p>
        <UChatPrompt
          v-model="prompt"
          placeholder="Describe the change you want..."
          variant="subtle"
          :disabled="
            loading
              || chatStatus === 'submitted'
              || chatStatus === 'streaming'
              || !selectedSectionId
          "
          :autofocus="false"
          @submit="_handleSubmit"
        />
        <div class="flex items-center justify-between text-xs text-muted-500">
          <span>{{ contentId }}</span>
          <UBadge
            :color="chatStatus === 'error' ? 'error' : 'primary'"
            variant="soft"
          >
            {{ chatStatus }}
          </UBadge>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
