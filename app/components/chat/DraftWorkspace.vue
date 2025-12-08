<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { PublishContentResponse } from '~~/server/types/content'
import type { WorkspaceHeaderState } from './workspaceHeader'
import { useClipboard } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDraftAction } from '~/composables/useDraftAction'
import ChatMessageContent from './ChatMessageContent.vue'
import PromptComposer from './PromptComposer.vue'

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

const { formatDateRelative } = useDate()

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
  workspaceSummary?: string | null
}

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
  sessionId,
  agentContext,
  prompt
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
    const updatedAtLabel = formatDateRelative(updatedAt, { includeTime: true })

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
    }>(`/api/drafts/${currentContentId}/header`)

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
      $fetch<{ messages: ContentChatMessage[] }>(`/api/drafts/${workspaceContentId}/messages`),
      $fetch<{ logs: ContentChatLog[] }>(`/api/drafts/${workspaceContentId}/logs`)
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
    const response = await $fetch<{ workspace: ContentResponse | null }>(`/api/drafts/${contentId.value}`)
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
const _sourceDetails = computed<SourceContent | null>(() => content.value?.sourceContent ?? null)

function _toDate(value: string | Date): Date | null {
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

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function formatScalar(value: any): string {
  if (value == null) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `"${escaped}"`
  }
  return JSON.stringify(value)
}

function toYamlLines(value: any, indent = 0): string[] {
  const prefix = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) {
      return [`${prefix}[]`]
    }
    return value.flatMap((entry) => {
      if (isPlainObject(entry) || Array.isArray(entry)) {
        const firstLine = `${prefix}-`
        const nested = toYamlLines(entry, indent + 1)
        return [firstLine, ...nested]
      }
      return [`${prefix}- ${formatScalar(entry)}`]
    })
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (!entries.length) {
      return [`${prefix}{}`]
    }
    return entries.flatMap(([key, entry]) => {
      if (isPlainObject(entry) || Array.isArray(entry)) {
        return [
          `${prefix}${key}:`,
          ...toYamlLines(entry, indent + 1)
        ]
      }
      return [`${prefix}${key}: ${formatScalar(entry)}`]
    })
  }
  return [`${prefix}${formatScalar(value)}`]
}

const FRONTMATTER_KEY_ORDER = [
  'title',
  'seoTitle',
  'description',
  'slug',
  'contentType',
  'content_type',
  'targetLocale',
  'locale',
  'status',
  'primaryKeyword',
  'keywords',
  'tags',
  'schemaTypes',
  'sourceContentId',
  'source_content_id',
  'wordCount',
  'version',
  'createdAt',
  'updatedAt'
]

function orderFrontmatter(frontmatter: Record<string, any>) {
  const orderedEntries: [string, any][] = []
  const seen = new Set<string>()
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      orderedEntries.push([key, frontmatter[key]])
      seen.add(key)
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (seen.has(key)) {
      continue
    }
    orderedEntries.push([key, value])
  }
  return Object.fromEntries(orderedEntries)
}

function _buildFrontmatterBlock(frontmatter: Record<string, any> | null | undefined) {
  if (!frontmatter || !isPlainObject(frontmatter)) {
    return '---\n---'
  }
  const filtered = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0
      }
      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0
      }
      return value !== null && value !== undefined && value !== ''
    })
  )
  const ordered = orderFrontmatter(filtered)
  const lines = toYamlLines(ordered)
  return ['---', ...lines, '---'].join('\n')
}

const title = computed(() => contentRecord.value?.title || 'Untitled draft')
const frontmatter = computed(() => currentVersion.value?.frontmatter || null)
const generatedContent = computed(() => currentVersion.value?.bodyMdx || currentVersion.value?.bodyHtml || null)
const hasGeneratedContent = computed(() => !!generatedContent.value)
const fullMdx = computed(() => {
  const body = typeof generatedContent.value === 'string' ? generatedContent.value.trim() : ''
  // Check if bodyMdx already contains frontmatter (enriched MDX)
  // Check if body starts with frontmatter block (--- followed by YAML and closing ---)
  // Use a more specific pattern to avoid regex backtracking issues
  const isEnriched = /^---\n[\s\S]*?\n---\n/m.test(body)
  if (isEnriched) {
    return body
  }
  const frontmatterBlock = _buildFrontmatterBlock(frontmatter.value || {})
  const parts = [frontmatterBlock, body].filter(part => typeof part === 'string' && part.trim().length)
  return parts.join('\n\n')
})
const hasFullMdx = computed(() => fullMdx.value.trim().length > 0)
const isPublishing = ref(false)
const canPublish = computed(() => {
  return hasFullMdx.value && Boolean(contentRecord.value?.id && currentVersion.value?.id)
})
const publishActionLabel = computed(() => isPublishing.value ? 'Publishing…' : 'Publish draft')
const contentDisplayTitle = computed(() => frontmatter.value?.seoTitle || frontmatter.value?.title || title.value)
const seoSnapshot = computed(() => currentVersion.value?.seoSnapshot || null)
const generatorDetails = computed(() => currentVersion.value?.assets?.generator || null)
const _generatorStages = computed(() => normalizeStringList(generatorDetails.value?.stages))
const _frontmatterTags = computed(() => normalizeStringList(frontmatter.value?.tags))
const _schemaTypes = computed(() => normalizeStringList(frontmatter.value?.schemaTypes))

const _seoPlan = computed(() => {
  const snapshot = seoSnapshot.value
  const plan = snapshot && typeof snapshot === 'object' ? snapshot.plan : null
  return plan && typeof plan === 'object' ? plan : null
})

const _seoKeywords = computed(() => normalizeStringList(_seoPlan.value?.keywords))
const _frontmatterKeywords = computed(() => normalizeStringList(frontmatter.value?.keywords))
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

const mentionableSections = computed(() => sections.value.map(section => ({
  id: section.id,
  title: section.title,
  anchor: section.anchor,
  summary: section.summary || null,
  preview: section.body?.slice(0, 200)?.trim() || ''
})))

const _currentContentRecordForDraft = computed<{ id: string, sourceContentId: string | null } | null>(() => {
  const record = contentRecord.value
  if (!record) {
    return null
  }
  return {
    id: record.id,
    sourceContentId: record.sourceContent?.id ?? null
  }
})

const {
  handleWriteDraftFromSource: _handleWriteDraftFromSourceComposable,
  handlePublishDraft: _handlePublishDraftFromPlan,
  isPublishing: _isPublishingFromPlan
} = useDraftAction({
  isBusy: chatIsBusy,
  status: chatStatus,
  sessionContentId,
  contentId,
  sendMessage,
  onLoadWorkspace: loadWorkspacePayload
})

const messageBodyClass = 'text-[15px] leading-6 text-muted-800 dark:text-muted-100'

const contentUpdatedAtLabel = computed(() => {
  return formatDateRelative(contentRecord.value?.updatedAt, { includeTime: true })
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

type ViewTabValue = 'summary' | 'source'
const viewTabs: { label: string, value: ViewTabValue }[] = [
  { label: 'Summary', value: 'summary' },
  { label: 'MDX Source', value: 'source' }
]

const activeViewTab = ref<ViewTabValue>('summary')

const headerTabs = computed(() => ({
  items: viewTabs.map(tab => ({ label: tab.label, value: tab.value })),
  modelValue: activeViewTab.value,
  onUpdate: (value: string) => {
    activeViewTab.value = value as ViewTabValue
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
      onArchive: null,
      onShare: hasFullMdx.value ? handleCopyFullMdx : null,
      onPrimaryAction: canPublish.value ? handlePublishDraft : null,
      primaryActionLabel: publishActionLabel.value,
      primaryActionColor: 'primary',
      primaryActionDisabled: !canPublish.value || isPublishing.value
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
    onArchive: null,
    onShare: hasFullMdx.value ? handleCopyFullMdx : null,
    onPrimaryAction: canPublish.value ? handlePublishDraft : null,
    primaryActionLabel: publishActionLabel.value,
    primaryActionColor: 'primary',
    primaryActionDisabled: !canPublish.value || isPublishing.value
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

function _insertSectionReference(sectionId: string) {
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

function handleCopyFullMdx() {
  if (!hasFullMdx.value) {
    toast.add({
      title: 'No MDX available',
      description: 'Generate content before copying the draft.',
      color: 'error'
    })
    return
  }

  try {
    copy(fullMdx.value)
    toast.add({
      title: 'Draft copied',
      description: 'Frontmatter and body copied to clipboard.',
      color: 'primary'
    })
  } catch (error) {
    console.error('Failed to copy MDX', error)
    toast.add({
      title: 'Copy failed',
      description: 'Could not copy the MDX draft.',
      color: 'error'
    })
  }
}

async function handlePublishDraft() {
  if (!canPublish.value || !contentRecord.value?.id || !currentVersion.value?.id) {
    toast.add({
      title: 'Cannot publish yet',
      description: 'Generate content before publishing.',
      color: 'error'
    })
    return
  }
  if (isPublishing.value) {
    return
  }
  try {
    isPublishing.value = true
    const response = await $fetch<PublishContentResponse>(`/api/content/${contentRecord.value.id}/publish`, {
      method: 'POST',
      body: {
        versionId: currentVersion.value.id
      }
    })
    // Map response status to ContentStatus (filter out invalid statuses)
    const mappedStatus: ContentStatus | undefined = (
      response.content.status === 'draft' ||
      response.content.status === 'published' ||
      response.content.status === 'archived'
    )
      ? response.content.status as ContentStatus
      : 'published'

    if (content.value) {
      content.value = {
        ...content.value,
        content: {
          id: response.content.id,
          title: response.content.title,
          status: mappedStatus,
          updatedAt: typeof response.content.updatedAt === 'string'
            ? response.content.updatedAt
            : new Date(response.content.updatedAt).toISOString(),
          metadata: {
            organizationId: response.content.organizationId,
            slug: response.content.slug,
            contentType: response.content.contentType,
            publishedAt: response.content.publishedAt
              ? (typeof response.content.publishedAt === 'string'
                  ? response.content.publishedAt
                  : new Date(response.content.publishedAt).toISOString())
              : null
          }
        },
        currentVersion: {
          id: response.version.id,
          bodyMdx: response.version.bodyMdx,
          bodyHtml: response.version.bodyHtml ?? undefined,
          frontmatter: response.version.frontmatter ?? undefined,
          version: response.version.version,
          updatedAt: typeof response.version.createdAt === 'string'
            ? response.version.createdAt
            : new Date(response.version.createdAt).toISOString()
        }
      }
    } else {
      // Handle case where content.value is null (shouldn't happen if canPublish passed)
      console.warn('[DraftWorkspace] Publishing without existing content state')
      content.value = {
        content: {
          id: response.content.id,
          title: response.content.title,
          status: mappedStatus,
          updatedAt: typeof response.content.updatedAt === 'string'
            ? response.content.updatedAt
            : new Date(response.content.updatedAt).toISOString(),
          metadata: {
            organizationId: response.content.organizationId,
            slug: response.content.slug,
            contentType: response.content.contentType,
            publishedAt: response.content.publishedAt
              ? (typeof response.content.publishedAt === 'string'
                  ? response.content.publishedAt
                  : new Date(response.content.publishedAt).toISOString())
              : null
          }
        },
        currentVersion: {
          id: response.version.id,
          bodyMdx: response.version.bodyMdx,
          bodyHtml: response.version.bodyHtml ?? undefined,
          frontmatter: response.version.frontmatter ?? undefined,
          version: response.version.version,
          updatedAt: typeof response.version.createdAt === 'string'
            ? response.version.createdAt
            : new Date(response.version.createdAt).toISOString()
        },
        sourceContent: null,
        chatSession: null,
        chatMessages: null,
        chatLogs: null,
        workspaceSummary: null
      }
    }
    toast.add({
      title: 'Draft published',
      description: response.file.url
        ? `Available at ${response.file.url}`
        : 'The latest version has been saved to your content storage.',
      color: 'primary'
    })
  } catch (error: any) {
    console.error('[DraftWorkspace] Failed to publish draft', error)
    const description = error?.data?.message || error?.message || 'An unexpected error occurred while publishing.'
    toast.add({
      title: 'Publish failed',
      description,
      color: 'error'
    })
  } finally {
    isPublishing.value = false
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

  // The agent will automatically determine which tool to use based on the natural language message
  // If a section is mentioned with @anchor, the agent will use patch_section tool
  // Otherwise, it will respond conversationally or use the appropriate tool
  try {
    await sendMessage(trimmed, {
      displayContent: trimmed,
      contentId: contentId.value || sessionContentId.value
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

        <!-- Agent Context Display -->
        <div
          v-if="agentContext && (agentContext.readySources?.length || agentContext.ingestFailures?.length)"
          class="space-y-4"
        >
          <!-- Ready Sources -->
          <UAlert
            v-if="agentContext.readySources && agentContext.readySources.length > 0"
            color="primary"
            variant="soft"
            icon="i-lucide-check-circle"
            title="Ready Sources"
          >
            <template #description>
              <div class="space-y-2">
                <div
                  v-for="source in agentContext.readySources"
                  :key="source.id"
                  class="text-sm"
                >
                  <strong>{{ source.title || 'Untitled source' }}</strong>
                  <span class="text-surface-500"> ({{ source.sourceType?.replace('_', ' ') || 'source' }})</span>
                </div>
              </div>
            </template>
          </UAlert>

          <!-- Ingestion Failures -->
          <UAlert
            v-if="agentContext.ingestFailures && agentContext.ingestFailures.length > 0"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            title="Ingestion Issues"
          >
            <template #description>
              <div class="space-y-1">
                <div
                  v-for="(failure, index) in agentContext.ingestFailures"
                  :key="index"
                  class="text-sm"
                >
                  {{ failure.content }}
                </div>
              </div>
            </template>
          </UAlert>
        </div>

        <div class="flex-1 flex flex-col gap-4">
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
                  onClick: (e, message) => handleSendAgain(message as ChatMessage)
                }
              ]
            }"
          >
            <template #content="{ message }">
              <ChatMessageContent
                :message="message"
                :body-class="messageBodyClass"
              />
            </template>
          </UChatMessages>

          <div class="space-y-2">
            <PromptComposer
              v-model="prompt"
              placeholder="Describe the change you want..."
              hint="Type @ to mention a file section."
              :sections="mentionableSections"
              :disabled="
                chatIsBusy
                  || chatStatus === 'submitted'
                  || chatStatus === 'streaming'
                  || !selectedSectionId
              "
              :status="uiStatus"
              @submit="_handleSubmit"
            >
              <template #submit>
                <UChatPromptSubmit
                  :status="uiStatus"
                  submitted-color="primary"
                  submitted-variant="solid"
                  streaming-color="primary"
                  streaming-variant="solid"
                />
              </template>
            </PromptComposer>
          </div>
        </div>
      </div>

      <div
        v-else-if="activeViewTab === 'source'"
        class="space-y-4"
      >
        <UCard v-if="hasGeneratedContent">
          <template #header>
            <div class="flex items-center justify-between">
              <p class="text-lg font-semibold">
                MDX source
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
    </section>
  </div>
</template>
