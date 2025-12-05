<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { WorkspaceHeaderState } from './workspaceHeader'
import { useClipboard } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PromptComposer from './PromptComposer.vue'

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
  ingestStatus?: 'pending' | 'processing' | 'ingested' | 'failed'
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
  contentId?: string | null
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
const toast = useToast()
const { copy } = useClipboard()
const {
  messages,
  status: chatStatus,
  errorMessage: chatErrorMessage,
  sendMessage,
  isBusy: chatIsBusy,
  hydrateSession,
  sessionContentId,
  sessionId
} = useChatSession()
const uiStatus = computed(() => chatStatus.value)
const workspaceHeaderState = useState<WorkspaceHeaderState | null>('workspace/header', () => null)

const content = ref<ContentResponse | null>(props.initialPayload ?? null)
const chatLoading = ref(false)
const pendingChatFetches = new Set<string>()
const headerData = ref<{
  title: string
  status: string | null
  contentType: string | null
  updatedAtLabel: string
  versionId: string | null
  additions: number
  deletions: number
  contentId: string | null
} | null>(null)
const pending = ref(!content.value)
const headerPending = ref(!content.value)
const error = ref<any>(null)
const readyEmitted = ref(false)

const emitReady = () => {
  if (!readyEmitted.value) {
    emit('ready')
    readyEmitted.value = true
  }
}

async function loadHeaderData() {
  if (!contentId.value) {
    headerData.value = null
    return
  }

  // Capture current contentId to prevent stale responses
  const currentContentId = contentId.value

  // Check cache first (from drafts list)
  const draftsListCache = useState<Map<string, any>>('drafts-list-cache', () => new Map())
  const cached = draftsListCache.value.get(currentContentId)

  if (cached) {
    // Verify contentId hasn't changed before updating state
    if (contentId.value !== currentContentId) {
      return
    }

    // Use cached data immediately - no API call needed!
    const updatedAt = cached.content?.updatedAt
    const updatedAtLabel = updatedAt
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(updatedAt))
      : '—'

    const contentType = cached.currentVersion?.frontmatter?.contentType || cached.content?.contentType || null
    const title = cached.content?.title || 'Untitled draft'
    const seoTitle = cached.currentVersion?.frontmatter?.seoTitle
    const frontmatterTitle = cached.currentVersion?.frontmatter?.title
    const displayTitle = seoTitle || frontmatterTitle || title

    // Verify again before setting state
    if (contentId.value !== currentContentId) {
      return
    }

    headerData.value = {
      title: displayTitle,
      status: cached.content?.status || 'draft',
      contentType,
      updatedAtLabel,
      versionId: cached.content?.currentVersionId || null,
      additions: cached._computed?.additions || 0,
      deletions: cached._computed?.deletions || 0,
      contentId: cached.content?.id || currentContentId
    }
    headerPending.value = false
    return // Skip API call!
  }

  // Only fetch if not in cache
  headerPending.value = true
  try {
    const header = await $fetch<{
      title: string
      status: string | null
      contentType: string | null
      updatedAtLabel: string
      versionId: string | null
      additions: number
      deletions: number
      contentId: string | null
    }>('/api/chat/workspace-header', {
      query: { contentId: currentContentId }
    })

    // Verify contentId hasn't changed before updating state
    if (contentId.value === currentContentId) {
      headerData.value = {
        ...header,
        status: header.status || 'draft',
        contentId: header.contentId || currentContentId
      }
    }
  } catch (err: any) {
    // Header load failure is non-critical, continue with full load
    console.warn('Failed to load header data', err)
  } finally {
    // Only update pending state if this is still the current request
    if (contentId.value === currentContentId) {
      headerPending.value = false
    }
  }
}

const fetchWorkspaceChat = async (workspaceContentId: string | null, sessionId: string | null) => {
  if (!workspaceContentId || !sessionId) {
    return
  }
  if (pendingChatFetches.has(workspaceContentId)) {
    return
  }

  pendingChatFetches.add(workspaceContentId)
  chatLoading.value = true
  try {
    const [messagesResponse, logsResponse] = await Promise.all([
      $fetch<{ messages: ContentChatMessage[] }>(`/api/chat/workspace/${workspaceContentId}/messages`),
      $fetch<{ logs: ContentChatLog[] }>(`/api/chat/workspace/${workspaceContentId}/logs`)
    ])

    if (!content.value || content.value.content.id !== workspaceContentId) {
      return
    }

    content.value = {
      ...content.value,
      chatMessages: messagesResponse.messages,
      chatLogs: logsResponse.logs
    }
  } catch (error) {
    console.error('[DraftWorkspace] Unable to fetch chat data', error)
  } finally {
    pendingChatFetches.delete(workspaceContentId)
    chatLoading.value = false
  }
}

const maybeFetchChatData = (payload: ContentResponse | null) => {
  const workspaceContentId = payload?.content?.id || null
  const sessionId = payload?.chatSession?.id || null
  if (!workspaceContentId || !sessionId) {
    return
  }
  if (Array.isArray(payload?.chatMessages) && Array.isArray(payload?.chatLogs)) {
    return
  }
  void fetchWorkspaceChat(workspaceContentId, sessionId)
}

async function loadWorkspacePayload() {
  if (!contentId.value) {
    content.value = null
    return
  }
  pending.value = true
  error.value = null
  try {
    const response = await $fetch<{ workspace: ContentResponse | null }>(`/api/chat/workspace/${contentId.value}`)
    content.value = response.workspace ?? null
    emitReady()
    maybeFetchChatData(content.value)
  } catch (err: any) {
    error.value = err
  } finally {
    pending.value = false
  }
}

if (content.value) {
  pending.value = false
  headerPending.value = false
  emitReady()
  maybeFetchChatData(content.value)
} else {
  // Load header first (lightweight), then full workspace
  await Promise.all([
    loadHeaderData(),
    loadWorkspacePayload()
  ])
}

watch(() => props.initialPayload, (value) => {
  if (value && value.content.id === contentId.value) {
    content.value = value
    pending.value = false
    emitReady()
    maybeFetchChatData(content.value)
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
    headerPending.value = false
    emitReady()
    maybeFetchChatData(content.value)
    return
  }
  // Load header first (lightweight), then full workspace
  await Promise.all([
    loadHeaderData(),
    loadWorkspacePayload()
  ])
})

const contentRecord = computed(() => content.value?.content ?? null)
const currentVersion = computed(() => content.value?.currentVersion ?? null)
const sourceDetails = computed<SourceContent | null>(() => content.value?.sourceContent ?? null)

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
  if (!value?.content?.id) {
    return
  }

  // Update cache with full workspace data when it loads
  const draftsListCache = useState<Map<string, any>>('drafts-list-cache', () => new Map())
  draftsListCache.value.set(value.content.id, {
    content: value.content,
    currentVersion: value.currentVersion,
    sourceContent: value.sourceContent,
    _computed: {
      wordCount: value.currentVersion?.sections?.reduce((sum: number, section: any) => {
        const wc = typeof section.wordCount === 'number' ? section.wordCount : 0
        return sum + wc
      }, 0) || 0,
      sectionsCount: Array.isArray(value.currentVersion?.sections) ? value.currentVersion.sections.length : 0,
      additions: value.currentVersion?.diffStats?.additions || value.currentVersion?.frontmatter?.diffStats?.additions || 0,
      deletions: value.currentVersion?.diffStats?.deletions || value.currentVersion?.frontmatter?.diffStats?.deletions || 0
    }
  })

  hydrateSession({
    sessionId: value.chatSession?.id ?? sessionId.value,
    sessionContentId: value.chatSession?.contentId ?? value.content.id,
    messages: value.chatMessages ?? undefined,
    logs: value.chatLogs ?? undefined
  })
}, { immediate: true })

const title = computed(() => contentRecord.value?.title || 'Untitled draft')
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
    parts: [{ type: 'text', text: 'Sections overview' }],
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
const displayMessages = computed(() => sectionsMessage.value ? [...messages.value, sectionsMessage.value] : messages.value)

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

type ViewTabValue = 'summary' | 'diff' | 'metadata'
const viewTabs: { label: string, value: ViewTabValue }[] = [
  { label: 'Summary', value: 'summary' },
  { label: 'Raw MDX', value: 'diff' },
  { label: 'Metadata', value: 'metadata' }
]

const activeViewTab = ref<ViewTabValue>('summary')

const headerTabs = computed(() => ({
  items: viewTabs,
  modelValue: activeViewTab.value,
  onUpdate: (value: ViewTabValue) => {
    activeViewTab.value = value
  }
}))

const headerPayload = computed<WorkspaceHeaderState | null>(() => {
  // Use lightweight header data if available (faster), fallback to full content
  if (headerData.value) {
    return {
      title: headerData.value.title,
      status: headerData.value.status || 'draft',
      contentType: headerData.value.contentType || 'content',
      updatedAtLabel: headerData.value.updatedAtLabel,
      versionId: headerData.value.versionId,
      additions: headerData.value.additions,
      deletions: headerData.value.deletions,
      tabs: headerTabs.value,
      contentId: headerData.value.contentId || contentId.value || null,
      showBackButton: showBackButton.value,
      onBack: showBackButton.value ? handleBackNavigation : null,
      // Mobile-focused: removed Archive, Share, and PrimaryAction buttons
      onArchive: null,
      onShare: null,
      onPrimaryAction: null,
      primaryActionLabel: '',
      primaryActionColor: '',
      primaryActionDisabled: false
    }
  }

  // Fallback to full content when available
  if (!contentRecord.value) {
    return null
  }
  return {
    title: contentDisplayTitle.value,
    status: contentRecord.value.status || 'draft',
    contentType: frontmatter.value?.contentType || 'content',
    updatedAtLabel: contentUpdatedAtLabel.value,
    versionId: currentVersion.value?.id || null,
    additions: diffStats.value.additions,
    deletions: diffStats.value.deletions,
    tabs: headerTabs.value,
    contentId: contentRecord.value.id || contentId.value || null,
    showBackButton: showBackButton.value,
    onBack: showBackButton.value ? handleBackNavigation : null,
    // Mobile-focused: removed Archive, Share, and PrimaryAction buttons
    onArchive: null,
    onShare: null,
    onPrimaryAction: null,
    primaryActionLabel: '',
    primaryActionColor: '',
    primaryActionDisabled: false
  }
})

watch(headerPayload, (value) => {
  workspaceHeaderState.value = value
}, { immediate: true })

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

function handleCopy(message: ChatMessage) {
  const rawText = message.parts[0]?.text ?? ''
  const hasContent = rawText.trim().length > 0

  if (!hasContent) {
    toast.add({
      title: 'Nothing to copy',
      description: 'This message has no text content.',
      color: 'error'
    })
    return
  }

  try {
    copy(rawText)
    toast.add({
      title: 'Copied to clipboard',
      description: 'Message copied successfully.',
      color: 'primary'
    })
  } catch (error) {
    console.error('Failed to copy message', error)
    toast.add({
      title: 'Copy failed',
      description: 'Could not copy message to clipboard.',
      color: 'error'
    })
  }
}

function handleRegenerate(message: ChatMessage) {
  const text = message.parts[0]?.text?.trim()
  if (!text) {
    toast.add({
      title: 'Cannot regenerate',
      description: 'This message has no text to resend.',
      color: 'error'
    })
    return
  }

  if (!selectedSectionId.value) {
    const fallbackSectionId = sections.value[0]?.id
    if (fallbackSectionId) {
      setActiveSection(fallbackSectionId)
      toast.add({
        title: 'Section auto-selected',
        description: `Regenerating content for “${sections.value[0]?.title || 'Untitled section'}”.`,
        color: 'info'
      })
    } else {
      toast.add({
        title: 'Select a section',
        description: 'Pick a section before regenerating content.',
        color: 'error'
      })
      return
    }
  }

  prompt.value = text
  _handleSubmit()
}

function handleSendAgain(message: ChatMessage) {
  const text = message.parts?.[0]?.text || ''
  if (text) {
    prompt.value = text
    _handleSubmit()
  }
}

async function _handleSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }

  const mentionedSection = sections.value.find(section => trimmed.includes(`@${section.anchor}`))
  const targetSection = mentionedSection || selectedSection.value

  const action = targetSection && contentId.value
    ? {
        type: 'patch_section',
        contentId: contentId.value,
        sectionId: targetSection.id,
        sectionTitle: targetSection.title,
        instructions: trimmed
      }
    : undefined

  try {
    await sendMessage(trimmed, {
      displayContent: trimmed,
      contentId: contentId.value || sessionContentId.value,
      action
    })
    prompt.value = ''
    await loadWorkspacePayload()
  } catch (error: any) {
    chatErrorMessage.value = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to send that message.'
  }
}

onBeforeUnmount(() => {
  workspaceHeaderState.value = null
})
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-4 pt-2">

      <div
        v-if="activeViewTab === 'summary'"
        class="space-y-6"
      >
        <UAlert
          v-if="chatErrorMessage"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="chatErrorMessage"
        />

        <div class="flex-1 flex flex-col gap-4">
          <UChatMessages
            :messages="displayMessages"
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
                  onClick: (e, message) => handleSendAgain(message as ChatMessage)
                }
              ]
            }"
          >
            <template #content="{ message }">
              <div
                v-if="message.payload?.type === 'sections_overview' && Array.isArray(message.payload.sections)"
                class="space-y-3"
              >
                <p class="text-sm font-semibold">
                  Sections overview
                </p>
                <UAccordion
                  :items="message.payload.sections.map((section: ContentVersionSection) => ({ value: section.id, section }))"
                  type="single"
                  collapsible
                  :ui="{ root: 'space-y-2' }"
                >
                  <template #default="{ item }">
                    <div
                      class="flex items-center justify-between gap-3 py-2"
                      :class="{ 'text-primary-600': selectedSectionId === item.section.id }"
                    >
                      <div class="min-w-0">
                        <p class="font-medium truncate">
                          {{ item.section.title }}
                        </p>
                        <p class="text-xs text-muted-500">
                          H{{ item.section.level }} • {{ item.section.wordCount }} words
                        </p>
                      </div>
                      <UBadge
                        size="xs"
                        :color="selectedSectionId === item.section.id ? 'primary' : 'neutral'"
                        class="capitalize"
                      >
                        {{ selectedSectionId === item.section.id ? 'Active' : item.section.type }}
                      </UBadge>
                    </div>
                  </template>
                  <template #content="{ item }">
                    <div class="space-y-2 text-sm">
                      <p
                        v-if="item.section.summary"
                        class="text-muted-500"
                      >
                        {{ item.section.summary }}
                      </p>
                      <p class="whitespace-pre-line">
                        {{ item.section.body?.slice(0, 280) }}{{ item.section.body?.length > 280 ? '…' : '' }}
                      </p>
                      <div class="flex flex-wrap items-center gap-2 pt-1">
                        <UBadge
                          size="xs"
                          color="primary"
                          variant="subtle"
                          class="cursor-pointer"
                          @click.stop="insertSectionReference(item.section.id)"
                        >
                          @{{ item.section.anchor }}
                        </UBadge>
                        <UButton
                          size="xs"
                          variant="ghost"
                          icon="i-lucide-target"
                          @click.stop="setActiveSection(item.section.id)"
                        >
                          Set active
                        </UButton>
                      </div>
                    </div>
                  </template>
                </UAccordion>
              </div>
              <div
                v-else
                class="whitespace-pre-line"
              >
                {{ message.parts[0]?.text }}
              </div>
            </template>
          </UChatMessages>

          <div class="space-y-2">
            <PromptComposer
              v-model="prompt"
              placeholder="Describe the change you want..."
              :disabled="
                chatIsBusy
                  || chatStatus === 'submitted'
                  || chatStatus === 'streaming'
                  || !selectedSectionId
              "
              :status="uiStatus"
              context-label="Current section"
              :context-value="selectedSection?.title || 'None'"
              @submit="_handleSubmit"
            />
          </div>
        </div>
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
            <div class="grid gap-3">
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
  </div>
</template>
