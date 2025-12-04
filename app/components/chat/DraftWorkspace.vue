<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { WorkspaceHeaderState } from '~/app/components/chat/workspaceHeader'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

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
    source?: {
      id?: string
      type?: string
      externalId?: string
      originalUrl?: string
      [key: string]: any
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
const _slug = computed(() => {
  if (props.organizationSlug)
    return props.organizationSlug
  const param = currentRoute.params.slug
  if (Array.isArray(param)) {
    return param[0]?.trim() || null
  }
  return param?.trim() || null
})
const contentId = computed(() => {
  if (props.contentId)
    return props.contentId
  const param = currentRoute.params.id
  if (Array.isArray(param)) {
    return param[0]?.trim() || ''
  }
  return param?.trim() || ''
})
const showBackButton = computed(() => props.showBackButton !== false)
const backRoute = computed(() => {
  if (props.backTo !== undefined) {
    return props.backTo
  }
  return '/'
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
const workspaceHeaderState = useState<WorkspaceHeaderState | null>('workspace/header', () => null)

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

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return value
  }
  const parsed = new Date(value)
  if (Number.isFinite(parsed.getTime())) {
    return parsed
  }
  console.warn('[DraftWorkspace] Failed to parse date value:', value)
  return null
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
      createdAt: toDate(message.createdAt) || new Date(),
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
const seoSnapshot = computed(() => currentVersion.value?.seoSnapshot || null)
const generatorDetails = computed(() => currentVersion.value?.assets?.generator || null)
const generatorStages = computed(() => normalizeStringList(generatorDetails.value?.stages))
const sourceAsset = computed(() => currentVersion.value?.assets?.source || null)
const frontmatterTags = computed(() => normalizeStringList(frontmatter.value?.tags))
const schemaTypes = computed(() => normalizeStringList(frontmatter.value?.schemaTypes))

const _seoPlan = computed(() => {
  const snapshot = seoSnapshot.value
  const plan = snapshot && typeof snapshot === 'object' ? snapshot.plan : null
  return plan && typeof plan === 'object' ? plan : null
})

const seoKeywords = computed(() => normalizeStringList(_seoPlan.value?.keywords))

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

const sectionsMessage = computed<ChatMessage | null>(() => {
  if (!sections.value.length) {
    return null
  }
  const timestamp = toDate(contentRecord.value?.updatedAt || new Date()) || new Date()
  return {
    id: 'sections-overview',
    role: 'assistant',
    content: 'Sections overview',
    createdAt: timestamp,
    payload: {
      type: 'sections_overview',
      sections: sections.value.map(section => ({
        id: section.id,
        title: section.title,
        summary: section.summary,
        level: section.level,
        wordCount: section.wordCount,
        type: section.type,
        anchor: section.anchor,
        body: section.body
      }))
    }
  }
})
const displayMessages = computed(() => sectionsMessage.value ? [...conversationMessages.value, sectionsMessage.value] : conversationMessages.value)

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

const publicContentUrl = computed(() => {
  if (!frontmatter.value?.slug) {
    return null
  }
  return `/${frontmatter.value.slug}`
})

const primaryActionLabel = computed(() => (isPublished.value ? 'View' : 'Publish'))
const primaryActionColor = computed(() => (isPublished.value ? 'primary' : 'success'))
const primaryActionDisabled = computed(() => !isPublished.value && pending.value)
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

const headerPayload = computed<WorkspaceHeaderState | null>(() => {
  if (!contentRecord.value) {
    return null
  }
  return {
    title: contentDisplayTitle.value,
    contentType: frontmatter.value?.contentType || 'content',
    updatedAtLabel: contentUpdatedAtLabel.value,
    versionId: currentVersion.value?.id || null,
    additions: diffStats.value.additions,
    deletions: diffStats.value.deletions,
    showBackButton: showBackButton.value,
    onBack: showBackButton.value ? handleBackNavigation : null,
    onArchive: handleArchive,
    onShare: handleShare,
    onPrimaryAction: handlePrimaryAction,
    primaryActionLabel: primaryActionLabel.value,
    primaryActionColor: primaryActionColor.value,
    primaryActionDisabled: primaryActionDisabled.value
  }
})

watch(headerPayload, (value) => {
  workspaceHeaderState.value = value
}, { immediate: true })

type ViewTabValue = 'diff' | 'metadata'
const viewTabs: { label: string, value: ViewTabValue }[] = [
  { label: 'Raw MDX', value: 'diff' },
  { label: 'Metadata', value: 'metadata' }
]

const activeViewTab = ref<ViewTabValue>('diff')

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter((item): item is string => Boolean(item && item.length))
}

const selectedSectionId = ref<string | null>(null)
const selectedSection = computed(() => sections.value.find(section => section.id === selectedSectionId.value) ?? null)

const _formatTranscriptText = (text: string) => {
  if (!text) {
    return ''
  }

  let cleaned = text
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

watch(sections, (list) => {
  if (!list.length) {
    selectedSectionId.value = null
    return
  }

  if (!selectedSectionId.value || !list.some(section => section.id === selectedSectionId.value)) {
    selectedSectionId.value = list[0]?.id ?? null
  }
}, { immediate: true })

function setActiveSection(sectionId: string | null) {
  if (!sectionId) {
    return
  }
  selectedSectionId.value = sectionId
}

function insertSectionReference(sectionId: string) {
  const section = sections.value.find(section => section.id === sectionId)
  if (!section) {
    return
  }
  setActiveSection(sectionId)
  const token = `@${section.anchor}`
  if (prompt.value.includes(token)) {
    return
  }
  prompt.value = prompt.value ? `${prompt.value.trimEnd()} ${token} ` : `${token} `
}

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
  workspaceHeaderState.value = null
})
</script>

<template>
  <UContainer class="space-y-6">
    <UAlert
      v-if="chatErrorMessage"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="chatErrorMessage"
    />

    <UCard class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold">
            Workspace chat
          </p>
          <p class="text-xs text-muted-500">
            Give instructions and reference sections with @anchors.
          </p>
        </div>

        <div
          v-if="_sourceLink"
          class="text-right text-xs"
        >
          <NuxtLink
            :href="_sourceLink"
            target="_blank"
            class="text-primary-500 hover:underline"
          >
            View source
          </NuxtLink>
        </div>
        <div
          v-if="selectedSection"
          class="flex items-center gap-2 text-xs text-muted-500"
        >
          <span>Editing</span>
          <UBadge
            size="xs"
            color="neutral"
          >
            {{ selectedSection.title }}
          </UBadge>
        </div>
      </div>

      <div class="space-y-3">
        <ChatMessagesList
          :messages="displayMessages"
          :selected-section-id="selectedSectionId"
          :status="chatStatus"
          @reference-section="insertSectionReference"
          @select-section="setActiveSection"
        />
      </div>

      <div class="space-y-2">
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
        <p class="text-xs text-muted-500">
          Current section: <span class="font-medium">{{ selectedSection?.title || 'None' }}</span>
        </p>
      </div>
    </UCard>

    <section class="space-y-4">
      <UTabs
        v-model="activeViewTab"
        :items="viewTabs"
        size="sm"
        :content="false"
        class="w-full"
      />

      <div
        v-if="activeViewTab === 'diff'"
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
        class="space-y-4"
      >
        <UCard v-if="frontmatter">
          <template #header>
            <div class="text-lg font-semibold">
              Frontmatter details
            </div>
          </template>
          <div class="space-y-4 text-sm">
            <div>
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Description
              </p>
              <p class="text-muted-700 dark:text-muted-200 whitespace-pre-line">
                {{ frontmatter?.description || '—' }}
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Content type
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ frontmatter?.contentType || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Target locale
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ frontmatter?.targetLocale || '—' }}
                </p>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Primary keyword
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ frontmatter?.primaryKeyword || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Source content ID
                </p>
                <p class="font-mono text-xs text-muted-700 dark:text-muted-200 break-all">
                  {{ frontmatter?.sourceContentId || sourceDetails?.id || sourceAsset?.id || '—' }}
                </p>
              </div>
            </div>
            <div
              v-if="frontmatterTags.length"
              class="space-y-2"
            >
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Tags
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="tag in frontmatterTags"
                  :key="tag"
                  size="xs"
                  color="neutral"
                >
                  {{ tag }}
                </UBadge>
              </div>
            </div>
            <div
              v-if="schemaTypes.length"
              class="space-y-2"
            >
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Schema types
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="schema in schemaTypes"
                  :key="schema"
                  size="xs"
                  color="primary"
                  variant="subtle"
                >
                  {{ schema }}
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>

        <UCard v-if="seoSnapshot">
          <template #header>
            <div class="text-lg font-semibold">
              SEO snapshot
            </div>
          </template>
          <div class="space-y-4 text-sm">
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Plan title
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ _seoPlan?.title || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Slug suggestion
                </p>
                <p class="font-mono text-xs text-muted-700 dark:text-muted-200 break-all">
                  {{ _seoPlan?.slugSuggestion || frontmatter?.slug || '—' }}
                </p>
              </div>
            </div>
            <div>
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Description
              </p>
              <p class="text-muted-700 dark:text-muted-200 whitespace-pre-line">
                {{ _seoPlan?.description || seoSnapshot?.description || '—' }}
              </p>
            </div>
            <div
              v-if="seoKeywords.length"
              class="space-y-2"
            >
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Keywords
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="keyword in seoKeywords"
                  :key="keyword"
                  size="xs"
                  color="success"
                  variant="subtle"
                >
                  {{ keyword }}
                </UBadge>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Primary keyword
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ seoSnapshot?.primaryKeyword || frontmatter?.primaryKeyword || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Schema types
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ (seoSnapshot?.schemaTypes || schemaTypes).join(', ') || '—' }}
                </p>
              </div>
            </div>
          </div>
        </UCard>

        <UCard v-if="generatorDetails || generatorStages.length || sourceDetails">
          <template #header>
            <div class="text-lg font-semibold">
              Pipeline & source
            </div>
          </template>
          <div class="space-y-4 text-sm">
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Engine
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ generatorDetails?.engine || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Generated at
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ generatorDetails?.generatedAt ? formatDate(generatorDetails.generatedAt) : '—' }}
                </p>
              </div>
            </div>
            <div
              v-if="generatorStages.length"
              class="space-y-2"
            >
              <p class="text-xs uppercase tracking-wide text-muted-500">
                Pipeline stages
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="stage in generatorStages"
                  :key="stage"
                  size="xs"
                  color="info"
                  variant="subtle"
                  class="capitalize"
                >
                  {{ stage }}
                </UBadge>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Source type
                </p>
                <p class="text-muted-700 dark:text-muted-200 capitalize">
                  {{ sourceDetails?.sourceType || sourceAsset?.type || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  External ID
                </p>
                <p class="font-mono text-xs text-muted-700 dark:text-muted-200 break-all">
                  {{ sourceDetails?.externalId || sourceAsset?.externalId || '—' }}
                </p>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Source status
                </p>
                <p class="text-muted-700 dark:text-muted-200 capitalize">
                  {{ sourceDetails?.ingestStatus || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-500">
                  Source created
                </p>
                <p class="text-muted-700 dark:text-muted-200">
                  {{ sourceDetails?.createdAt ? formatDate(sourceDetails.createdAt) : '—' }}
                </p>
              </div>
            </div>
          </div>
        </UCard>

        <UAlert
          v-if="!frontmatter && !seoSnapshot && !generatorDetails"
          color="neutral"
          variant="soft"
          icon="i-lucide-info"
          description="Metadata will appear once a draft version has been generated."
        />
      </div>
    </section>
  </UContainer>
</template>
