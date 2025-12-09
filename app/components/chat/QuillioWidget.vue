<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { PublishContentResponse } from '~~/server/types/content'
import type { WorkspaceHeaderState } from './workspaceHeader'
import { useClipboard, useDebounceFn } from '@vueuse/core'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import BillingUpgradeModal from '~/components/billing/UpgradeModal.vue'
import { useDraftAction } from '~/composables/useDraftAction'
import { resolveAiThinkingIndicator } from '~/utils/aiThinkingIndicators'
import ChatMessageContent from './ChatMessageContent.vue'
import PromptComposer from './PromptComposer.vue'
import QuotaLimitModal from './QuotaLimitModal.vue'

// Workspace types and interfaces
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

interface ContentConversation {
  id: string
  status?: string | null
  contentId?: string | null
  sourceContentId?: string | null
  metadata?: Record<string, any> | null
}

interface ContentConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

interface ContentConversationLog {
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
  chatSession?: ContentConversation | null
  chatMessages?: ContentConversationMessage[] | null
  chatLogs?: ContentConversationLog[] | null
  workspaceSummary?: string | null
}

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const { loggedIn, useActiveOrganization, refreshActiveOrg, signIn } = auth
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  conversationContentId,
  conversationId,
  resetConversation,
  selectedContentType,
  stopResponse,
  logs,
  requestStartedAt,
  prompt,
  mode,
  currentActivity,
  currentToolName,
  hydrateConversation
} = useConversation()
const promptSubmitting = ref(false)
const showQuotaModal = ref(false)
const quotaModalData = ref<{ limit: number | null, used: number | null, remaining: number | null, planLabel: string | null } | null>(null)
const showUpgradeModal = ref(false)
const LONG_PRESS_DELAY_MS = 500
const LONG_PRESS_MOVE_THRESHOLD_PX = 10

const { copy } = useClipboard()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()

const messageActionSheetOpen = ref(false)
const messageActionSheetTarget = ref<ChatMessage | null>(null)
let longPressTimeout: ReturnType<typeof setTimeout> | null = null
let longPressStartPosition: { x: number, y: number } | null = null

function getEventCoordinates(event?: Event | null): { x: number, y: number } | null {
  if (!event)
    return null

  if ('touches' in event) {
    const touchEvent = event as TouchEvent
    const touch = touchEvent.touches?.[0]
    if (!touch)
      return null
    return { x: touch.clientX, y: touch.clientY }
  }

  if ('clientX' in event && 'clientY' in event) {
    const mouseEvent = event as MouseEvent
    return { x: mouseEvent.clientX, y: mouseEvent.clientY }
  }

  return null
}

const parseConversationLimitValue = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }
  return fallback
}

const guestConversationLimit = computed(() => parseConversationLimitValue((runtimeConfig.public as any)?.conversationQuota?.anonymous, 10))
const verifiedConversationLimit = computed(() => parseConversationLimitValue((runtimeConfig.public as any)?.conversationQuota?.verified, 50))

const activeWorkspaceId = ref<string | null>(null)
const workspaceDetail = shallowRef<any | null>(null)
const workspaceLoading = ref(false)
const archivingConversationId = ref<string | null>(null)
const pendingDrafts = ref<Array<{ id: string, contentType: string | null }>>([])
const conversationQuotaState = useState<ConversationQuotaUsagePayload | null>('conversation-quota-usage', () => null)
const workspacePayloadCache = useState<Record<string, { payload: any | null, timestamp: number }>>('workspace-payload-cache', () => ({}))
const WORKSPACE_CACHE_TTL_MS = 30_000

const scheduleIdleTask = (fn: () => void) => {
  if (typeof window === 'undefined')
    return
  const idle = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined
  if (typeof idle === 'function') {
    idle(() => fn())
  } else {
    setTimeout(() => fn(), 200)
  }
}

const prefetchWorkspacePayload = (conversationId?: string | null) => {
  if (!import.meta.client || !conversationId) {
    return
  }
  scheduleIdleTask(() => {
    const cacheEntry = workspacePayloadCache.value[conversationId]
    const now = Date.now()
    if (cacheEntry && (now - cacheEntry.timestamp) < WORKSPACE_CACHE_TTL_MS) {
      return
    }
    // Prefetch conversation and its artifacts
    Promise.all([
      $fetch<{ conversation: any }>(`/api/conversations/${conversationId}`).catch(() => null),
      $fetch<{ artifacts: Array<{ contentId: string }> }>(`/api/conversations/${conversationId}/artifacts`).catch(() => ({ artifacts: [] }))
    ]).then(([convResponse, artifactsResponse]) => {
      if (!convResponse)
        return
      const contentId = artifactsResponse.artifacts?.[0]?.contentId || convResponse.conversation.contentId
      if (contentId) {
        return $fetch<{ workspace?: any | null }>(`/api/content/${contentId}`)
          .then((response) => {
            workspacePayloadCache.value[conversationId] = {
              payload: response?.workspace ?? null,
              timestamp: Date.now()
            }
          })
      }
    }).catch(() => {
      // Ignore prefetch errors
    })
  })
}
interface ConversationQuotaUsagePayload {
  limit: number | null
  used: number | null
  remaining: number | null
  label?: string | null
  unlimited?: boolean
  profile?: 'anonymous' | 'verified' | 'paid'
}

interface ConversationListResponse {
  conversations: Array<{
    id: string
    status: string
    updatedAt: Date | string
    createdAt: Date | string
    contentId: string | null
    sourceContentId: string | null
    metadata: Record<string, any> | null
    _computed?: {
      artifactCount: number
      firstArtifactTitle: string | null
    }
  }>
  conversationQuota?: ConversationQuotaUsagePayload | null
}

const {
  data: conversationsPayload,
  pending: conversationsPending,
  refresh: refreshConversations
} = await useFetch<ConversationListResponse>('/api/conversations', {
  default: () => ({
    conversations: []
  })
})
const debouncedRefreshConversations = useDebounceFn(() => refreshConversations(), 300)
// Populate conversation list cache for header reuse
const conversationListCache = useState<Map<string, any>>('conversation-list-cache', () => new Map())

const updateLocalConversationStatus = (conversationId: string, status: string) => {
  const currentPayload = conversationsPayload.value
  if (!currentPayload?.conversations?.length)
    return

  const nextConversations = currentPayload.conversations.map((conv) => {
    if (conv.id !== conversationId)
      return conv
    return {
      ...conv,
      status
    }
  })

  conversationsPayload.value = {
    ...currentPayload,
    conversations: nextConversations
  }

  const archivedConversation = nextConversations.find(conv => conv.id === conversationId)
  if (archivedConversation) {
    conversationListCache.value.set(conversationId, archivedConversation)
  }
}
const isWorkspaceActive = computed(() => Boolean(activeWorkspaceId.value))

// Workspace-specific state (merged from ConversationWorkspace)
// Use instance-scoped ref instead of global useState to avoid wiping state for other widget instances
const workspaceHeaderState = ref<WorkspaceHeaderState | null>(null)
const workspaceContent = ref<ContentResponse | null>(null)
const workspacePending = ref(false)
const workspaceError = ref<any>(null)
const workspaceChatLoading = ref(false)
const pendingWorkspaceChatFetches = new Set<string>()
const selectedSectionId = ref<string | null>(null)
const isPublishing = ref(false)

const conversationQuotaUsage = computed<ConversationQuotaUsagePayload | null>(() =>
  conversationsPayload.value?.conversationQuota ?? null
)
const quotaPlanLabel = computed(() => conversationQuotaUsage.value?.label ?? (loggedIn.value ? 'Current plan' : 'Guest access'))

watch(conversationQuotaUsage, (value) => {
  if (value) {
    conversationQuotaState.value = {
      limit: value.limit ?? null,
      used: value.used ?? null,
      remaining: value.remaining ?? null,
      label: value.label ?? null,
      unlimited: value.unlimited ?? false
    }
  } else {
    conversationQuotaState.value = null
  }
}, { immediate: true, deep: true })

const fetchedConversationEntries = computed(() => {
  const list = Array.isArray(conversationsPayload.value?.conversations) ? conversationsPayload.value?.conversations : []
  return list.map((conv: any) => {
    let updatedAt: Date | null = null
    if (conv.updatedAt) {
      const parsedDate = new Date(conv.updatedAt)
      updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
    }

    return {
      id: conv.id,
      title: conv._computed?.title || conv._computed?.firstArtifactTitle || 'Untitled conversation',
      status: conv.status,
      updatedAt,
      artifactCount: conv._computed?.artifactCount ?? 0,
      contentId: conv.contentId,
      sourceContentId: conv.sourceContentId,
      metadata: conv.metadata
    }
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
})

const pendingConversationEntries = computed(() => {
  const existingIds = new Set(fetchedConversationEntries.value.map(entry => entry.id))

  return pendingDrafts.value
    .filter(entry => entry.id && !existingIds.has(entry.id))
    .map(entry => ({
      id: entry.id,
      title: 'New conversation',
      status: 'active',
      updatedAt: null,
      artifactCount: 0,
      contentId: null,
      sourceContentId: null,
      metadata: null,
      isPending: true
    }))
})

const conversationEntries = computed(() => {
  return [
    ...pendingConversationEntries.value,
    ...fetchedConversationEntries.value
  ]
})

watch(conversationId, (value, previous) => {
  if (!value || value === previous)
    return

  const alreadyPresent = fetchedConversationEntries.value.some(entry => entry.id === value)
    || pendingDrafts.value.some(entry => entry.id === value)

  if (alreadyPresent)
    return

  // Remove any temp entries (they'll be replaced by the real conversation)
  pendingDrafts.value = pendingDrafts.value.filter(entry => !entry.id.startsWith('temp-'))

  pendingDrafts.value = [
    { id: value, contentType: selectedContentType.value || null },
    ...pendingDrafts.value
  ]

  debouncedRefreshConversations()
})

watch(fetchedConversationEntries, (entries) => {
  const presentIds = new Set(entries.map(entry => entry.id))
  pendingDrafts.value = pendingDrafts.value.filter(entry => !presentIds.has(entry.id))
})

const activeWorkspaceEntry = computed(() => conversationEntries.value.find(entry => entry.id === activeWorkspaceId.value) ?? null)
const isStreaming = computed(() => ['submitted', 'streaming'].includes(status.value))
const uiStatus = computed(() => status.value)
const shouldShowWhatsNew = computed(() => !isWorkspaceActive.value && messages.value.length === 0)
const THINKING_MESSAGE_ID = 'quillio-thinking-placeholder'
const aiThinkingIndicator = computed(() => resolveAiThinkingIndicator({
  status: status.value,
  logs: logs.value,
  activeSince: requestStartedAt.value,
  fallbackMessage: 'Working on your content...',
  currentActivity: currentActivity.value,
  currentToolName: currentToolName.value
}))
const displayMessages = computed<ChatMessage[]>(() => {
  const baseMessages = messages.value.slice()

  if (isStreaming.value) {
    if (!baseMessages.some(message => message.id === THINKING_MESSAGE_ID)) {
      baseMessages.push({
        id: THINKING_MESSAGE_ID,
        role: 'assistant',
        parts: [{ type: 'text' as const, text: aiThinkingIndicator.value.message }],
        createdAt: new Date(),
        payload: { placeholder: true }
      })
    }

    return baseMessages
  }

  return baseMessages.filter(message => message.id !== THINKING_MESSAGE_ID)
})

useDraftAction({
  isBusy,
  status,
  conversationContentId,
  selectedContentType,
  pendingDrafts,
  sendMessage,
  onRefresh: async () => {
    await refreshConversations()
    if (activeWorkspaceId.value) {
      prefetchWorkspacePayload(activeWorkspaceId.value)
    }
  }
})

const openQuotaModal = (payload?: { limit?: number | null, used?: number | null, remaining?: number | null, label?: string | null } | null) => {
  const fallback = conversationQuotaUsage.value

  // Simplified: guest vs logged-in only
  const isGuest = !loggedIn.value
  const baseLimit = payload?.limit ?? fallback?.limit ?? (isGuest ? guestConversationLimit.value : verifiedConversationLimit.value)
  const usedValue = payload?.used ?? fallback?.used ?? 0
  const remainingValue = payload?.remaining ?? fallback?.remaining ?? (baseLimit !== null ? Math.max(0, baseLimit - usedValue) : null)

  quotaModalData.value = {
    limit: baseLimit,
    used: usedValue,
    remaining: remainingValue,
    planLabel: payload?.label ?? fallback?.label ?? quotaPlanLabel.value ?? null
  }
  showQuotaModal.value = true
}

const quotaModalMessage = computed(() => {
  if (!loggedIn.value) {
    return `Make an account to unlock ${verifiedConversationLimit.value} total conversations or archive conversations to continue chatting.`
  }
  if (conversationQuotaUsage.value?.unlimited) {
    return 'Your current plan includes unlimited conversations.'
  }
  return 'Starter plans have a conversation limit. Upgrade to unlock unlimited conversations or archive conversations to continue chatting.'
})

const quotaModalTitle = computed(() => {
  const limit = quotaModalData.value?.limit ?? conversationQuotaUsage.value?.limit ?? null
  const used = quotaModalData.value?.used ?? conversationQuotaUsage.value?.used ?? null
  if (typeof limit === 'number') {
    const remaining = Math.max(0, limit - (typeof used === 'number' ? used : 0))
    return `You have ${remaining}/${limit} conversations remaining.`
  }
  if (conversationQuotaUsage.value?.unlimited) {
    return 'Unlimited conversations unlocked.'
  }
  return loggedIn.value ? 'Upgrade to unlock more conversations.' : 'Create an account for more conversations.'
})

const quotaPrimaryLabel = computed(() => {
  if (!loggedIn.value)
    return 'Sign up'
  if (conversationQuotaUsage.value?.unlimited)
    return 'Close'
  return 'Upgrade'
})

const handleQuotaModalPrimary = () => {
  showQuotaModal.value = false
  if (conversationQuotaUsage.value?.unlimited) {
    // For unlimited plans, just close the modal
    return
  }
  if (loggedIn.value) {
    showUpgradeModal.value = true
    return
  }
  const destination = `/signup?redirect=${encodeURIComponent('/')}`
  router.push(destination)
}

const handleQuotaModalCancel = () => {
  showQuotaModal.value = false
}

const handleUpgradeSuccess = async () => {
  showUpgradeModal.value = false
  await refreshActiveOrg()
  await refreshConversations()
}

const handleQuotaGoogleSignup = () => {
  showQuotaModal.value = false
  if (typeof window === 'undefined')
    return
  try {
    signIn.social?.({
      provider: 'google',
      callbackURL: window.location.href
    })
  } catch (error) {
    console.error('Failed to start Google signup', error)
  }
}

const handleQuotaEmailSignup = () => {
  showQuotaModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signup?redirect=${encodeURIComponent(redirect)}`)
}

if (import.meta.client) {
  const handleQuotaEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ limit?: number, used?: number, remaining?: number, label?: string, unlimited?: boolean }>).detail
    openQuotaModal(detail || undefined)
  }
  onMounted(() => {
    window.addEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
}

const handlePromptSubmit = async (value?: string) => {
  const input = typeof value === 'string' ? value : prompt.value
  const trimmed = input.trim()
  if (!trimmed) {
    return
  }
  promptSubmitting.value = true
  try {
    await sendMessage(trimmed)
    if (activeWorkspaceId.value) {
      prefetchWorkspacePayload(activeWorkspaceId.value)
    }
    prompt.value = ''
  } finally {
    promptSubmitting.value = false
  }
}

const loadWorkspaceDetail = async (conversationId: string) => {
  if (!conversationId) {
    workspaceDetail.value = null
    return
  }

  const cacheEntry = workspacePayloadCache.value[conversationId]
  const now = Date.now()

  if (cacheEntry) {
    workspaceDetail.value = cacheEntry.payload
    if (now - cacheEntry.timestamp < WORKSPACE_CACHE_TTL_MS) {
      workspaceLoading.value = false
      return
    }
  } else {
    workspaceDetail.value = null
  }

  workspaceLoading.value = !cacheEntry
  try {
    // First, get the conversation to find its content artifacts
    const conversationResponse = await $fetch<{ conversation: any }>(`/api/conversations/${conversationId}`)
    const conversation = conversationResponse.conversation

    // Get artifacts for this conversation
    const artifactsResponse = await $fetch<{ artifacts: Array<{ contentId: string, data: any }> }>(`/api/conversations/${conversationId}/artifacts`)

    // Use the first content artifact, or the legacy contentId if available
    const contentIdToLoad = artifactsResponse.artifacts?.[0]?.contentId || conversation.contentId

    if (contentIdToLoad) {
      // Load the content workspace
      const workspaceResponse = await $fetch<{ workspace?: any | null }>(`/api/content/${contentIdToLoad}`)
      const payload = workspaceResponse.workspace ?? null
      workspaceDetail.value = payload
      workspacePayloadCache.value[conversationId] = {
        payload,
        timestamp: Date.now()
      }
    } else {
      // No content artifacts yet - create a minimal workspace payload
      workspaceDetail.value = {
        conversation: {
          id: conversation.id,
          status: conversation.status,
          metadata: conversation.metadata
        },
        content: null,
        artifacts: artifactsResponse.artifacts || []
      }
      workspacePayloadCache.value[conversationId] = {
        payload: workspaceDetail.value,
        timestamp: Date.now()
      }
    }
  } catch (error) {
    console.error('Unable to load conversation workspace', error)
    if (!cacheEntry) {
      workspaceDetail.value = null
    }
  } finally {
    workspaceLoading.value = false
  }
}

const normalizeContentId = (value: unknown): string | null => {
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

const routeContentId = computed(() => normalizeContentId(route.query.content))

const syncWorkspace = async (conversationId: string | null) => {
  if (!conversationId) {
    resetWorkspaceState()
    return
  }
  if (activeWorkspaceId.value === conversationId && workspaceDetail.value) {
    return
  }
  activeWorkspaceId.value = conversationId
  await loadWorkspaceDetail(conversationId)
}

const scheduleSyncWorkspace = useDebounceFn((conversationId: string | null) => {
  void syncWorkspace(conversationId)
}, 200)

const updateContentRoute = async (contentId: string | null) => {
  const nextQuery = { ...route.query }
  if (contentId) {
    nextQuery.content = contentId
  } else {
    delete nextQuery.content
  }
  try {
    await router.replace({ query: nextQuery })
  } catch (error) {
    console.warn('Failed to update content route', error)
  }
}

const initialContentId = computed(() => routeContentId.value ?? null)

await syncWorkspace(initialContentId.value)

const activateWorkspace = async (conversationId: string | null) => {
  await updateContentRoute(conversationId)
}

const openConversation = async (entry: { id: string }) => {
  // Open conversation by conversationId (not contentId)
  await activateWorkspace(entry.id)
}

const archiveConversation = async (entry: { id: string, title?: string | null }) => {
  if (!entry?.id || archivingConversationId.value === entry.id)
    return

  archivingConversationId.value = entry.id

  try {
    await $fetch(`/api/conversations/${entry.id}`, {
      method: 'DELETE'
    })

    updateLocalConversationStatus(entry.id, 'archived')

    if (activeWorkspaceId.value === entry.id) {
      await activateWorkspace(null)
      resetConversation()
    }

    await refreshConversations()

    toast.add({
      title: 'Content archived',
      description: entry.title || 'Content moved to archive.',
      color: 'neutral',
      icon: 'i-lucide-archive'
    })
  } catch (error: any) {
    const message = error?.data?.statusMessage || error?.statusMessage || 'Failed to archive conversation'
    toast.add({
      title: 'Archive failed',
      description: message,
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  } finally {
    archivingConversationId.value = null
  }
}

const stopWorkingContent = (entry: { id: string }) => {
  if (!entry?.id || entry.id !== conversationContentId.value) {
    return
  }

  const stopped = stopResponse()
  pendingDrafts.value = pendingDrafts.value.filter(content => content.id !== entry.id)

  if (stopped) {
    toast.add({
      title: 'Generation stopped',
      description: 'Draft generation halted.',
      color: 'neutral',
      icon: 'i-lucide-square'
    })
  }
}

const closeWorkspace = async () => {
  const previousWorkspaceId = activeWorkspaceId.value
  await activateWorkspace(null)
  resetConversation()
  prefetchWorkspacePayload(previousWorkspaceId)
  // Clean up workspace state
  workspaceContent.value = null
  workspaceHeaderState.value = null
  selectedSectionId.value = null
}

// Workspace content management functions (from ConversationWorkspace)
const { formatDateRelative } = useDate()

const workspaceContentId = computed(() => {
  if (workspaceDetail.value?.content?.id) {
    return workspaceDetail.value.content.id
  }
  return null
})

function handleBackNavigation() {
  if (activeWorkspaceId.value) {
    closeWorkspace()
  } else {
    router.push('/')
  }
}

const fetchWorkspaceChat = async (workspaceContentId: string | null, existingConversationId: string | null) => {
  if (!workspaceContentId) {
    return
  }
  if (pendingWorkspaceChatFetches.has(workspaceContentId)) {
    return
  }

  pendingWorkspaceChatFetches.add(workspaceContentId)
  workspaceChatLoading.value = true
  try {
    let conversationId = existingConversationId
    if (!conversationId) {
      const workspaceResponse = await $fetch<{ workspace: ContentResponse | null }>(`/api/content/${workspaceContentId}`)
      conversationId = workspaceResponse.workspace?.chatSession?.id ?? null
    }

    if (!conversationId) {
      return
    }

    const [messagesResponse, logsResponse] = await Promise.all([
      $fetch<{ messages: ContentConversationMessage[] }>(`/api/conversations/${conversationId}/messages`),
      $fetch<{ logs: ContentConversationLog[] }>(`/api/conversations/${conversationId}/logs`)
    ])

    if (!workspaceContent.value || workspaceContent.value.content.id !== workspaceContentId) {
      return
    }

    workspaceContent.value = {
      ...workspaceContent.value,
      chatMessages: messagesResponse.messages,
      chatLogs: logsResponse.logs
    }
  } catch (error) {
    console.error('Unable to fetch conversation data', error)
  } finally {
    pendingWorkspaceChatFetches.delete(workspaceContentId)
    workspaceChatLoading.value = false
  }
}

const maybeFetchChatData = (payload: ContentResponse | null) => {
  const workspaceContentId = payload?.content?.id || null
  const conversationId = payload?.chatSession?.id || null
  if (!workspaceContentId || !conversationId) {
    return
  }
  if (Array.isArray(payload?.chatMessages) && Array.isArray(payload?.chatLogs)) {
    return
  }
  void fetchWorkspaceChat(workspaceContentId, conversationId)
}

async function loadWorkspacePayload() {
  const contentId = workspaceContentId.value
  if (!contentId) {
    workspaceContent.value = null
    return
  }
  workspacePending.value = true
  workspaceError.value = null
  try {
    const response = await $fetch<{ workspace: ContentResponse | null }>(`/api/content/${contentId}`)
    workspaceContent.value = response.workspace ?? null
    maybeFetchChatData(workspaceContent.value)
  } catch (err: any) {
    workspaceError.value = err
  } finally {
    workspacePending.value = false
  }
}

// Initialize workspace when workspaceDetail changes
watch(() => workspaceDetail.value, async (detail) => {
  if (detail?.content?.id) {
    // If detail is already a ContentResponse (has currentVersion), use it directly
    if (detail.content && 'currentVersion' in detail) {
      workspaceContent.value = detail as ContentResponse
      maybeFetchChatData(workspaceContent.value)
    } else {
      // Otherwise load it
      await loadWorkspacePayload()
    }
  } else if (detail?.conversation) {
    // Conversation without content yet - just clear workspace content
    workspaceContent.value = null
  } else {
    // No workspace detail
    workspaceContent.value = null
  }
}, { immediate: true })

// Workspace computed properties
const workspaceContentRecord = computed(() => workspaceContent.value?.content ?? null)
const workspaceCurrentVersion = computed(() => workspaceContent.value?.currentVersion ?? null)
const workspaceGeneratedContent = computed(() => workspaceCurrentVersion.value?.bodyMdx || workspaceCurrentVersion.value?.bodyHtml || null)

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const workspaceSections = computed(() => {
  const sectionsData = workspaceCurrentVersion.value?.sections
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

watch(workspaceSections, (list) => {
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

// Workspace MDX helpers - simplified for copy button only
const workspaceFullMdx = computed(() => {
  const body = typeof workspaceGeneratedContent.value === 'string' ? workspaceGeneratedContent.value.trim() : ''
  // If body already has frontmatter, return as-is
  const isEnriched = /^---\n[\s\S]*?\n---\n/m.test(body)
  if (isEnriched) {
    return body
  }
  // If no frontmatter in body, just return the body without adding frontmatter
  // The server handles proper MDX enrichment when needed
  return body
})

const workspaceHasFullMdx = computed(() => workspaceFullMdx.value.trim().length > 0)
const workspaceCanPublish = computed(() => {
  return workspaceHasFullMdx.value && Boolean(workspaceContentRecord.value?.id && workspaceCurrentVersion.value?.id)
})
const workspacePublishActionLabel = computed(() => isPublishing.value ? 'Publishing…' : 'Publish draft')

// Workspace header state
const workspaceHeaderPayload = computed<WorkspaceHeaderState | null>(() => {
  if (!isWorkspaceActive.value || !workspaceContentId.value) {
    return null
  }

  const content = workspaceContent.value?.content
  const version = workspaceContent.value?.currentVersion
  const frontmatter = version?.frontmatter

  if (!content) {
    return null
  }

  const title = frontmatter?.seoTitle || frontmatter?.title || content.title || 'Untitled content'
  const updatedAtLabel = formatDateRelative(content.updatedAt, { includeTime: true })
  const additions = version?.diffStats?.additions || frontmatter?.diffStats?.additions || 0
  const deletions = version?.diffStats?.deletions || frontmatter?.diffStats?.deletions || 0

  return {
    title,
    status: content.status || 'draft',
    contentType: frontmatter?.contentType || 'content',
    updatedAtLabel,
    versionId: version?.id || null,
    additions,
    deletions,
    tabs: null,
    contentId: content.id || workspaceContentId.value || null,
    showBackButton: true,
    onBack: handleBackNavigation,
    onArchive: null,
    onShare: workspaceHasFullMdx.value ? handleCopyFullMdx : null,
    onPrimaryAction: workspaceCanPublish.value ? handlePublishDraft : null,
    primaryActionLabel: workspacePublishActionLabel.value,
    primaryActionColor: 'primary',
    primaryActionDisabled: !workspaceCanPublish.value || isPublishing.value
  }
})

watch(workspaceHeaderPayload, (value) => {
  workspaceHeaderState.value = value
}, { immediate: true })

// Update cache when workspace content loads
watch(workspaceContent, (value) => {
  if (!value?.content?.id) {
    return
  }

  const contentListCache = useState<Map<string, any>>('content-list-cache', () => new Map())
  contentListCache.value.set(value.content.id, {
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

  hydrateConversation({
    conversationId: value.chatSession?.id ?? conversationId.value,
    conversationContentId: value.chatSession?.contentId ?? value.content.id,
    messages: value.chatMessages ?? undefined,
    logs: value.chatLogs ?? undefined
  })
}, { immediate: true })

watch(routeContentId, (contentId) => {
  scheduleSyncWorkspace(contentId ?? null)
})

onBeforeUnmount(() => {
  clearMessageLongPress()
  workspaceHeaderState.value = null
})

function getMessageText(message: ChatMessage) {
  return message.parts[0]?.text || ''
}

function getDisplayMessageText(message: ChatMessage) {
  return getMessageText(message)
}

async function handleCopy(message: ChatMessage) {
  const rawText = getMessageText(message)
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
    await copy(rawText)
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

// Workspace handlers
async function handleCopyFullMdx() {
  if (!workspaceHasFullMdx.value) {
    toast.add({
      title: 'No MDX available',
      description: 'Generate content before copying the draft.',
      color: 'error'
    })
    return
  }

  try {
    await copy(workspaceFullMdx.value)
    toast.add({
      title: 'Draft copied',
      description: 'Content copied to clipboard.',
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
  if (!workspaceCanPublish.value || !workspaceContentRecord.value?.id || !workspaceCurrentVersion.value?.id) {
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
    const response = await $fetch<PublishContentResponse>(`/api/content/${workspaceContentRecord.value.id}/publish`, {
      method: 'POST',
      body: {
        versionId: workspaceCurrentVersion.value.id
      }
    })
    const mappedStatus: ContentStatus | undefined = (
      response.content.status === 'draft' ||
      response.content.status === 'published' ||
      response.content.status === 'archived'
    )
      ? response.content.status as ContentStatus
      : 'published'

    if (workspaceContent.value) {
      workspaceContent.value = {
        ...workspaceContent.value,
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
    }
    toast.add({
      title: 'Draft published',
      description: response.file.url
        ? `Available at ${response.file.url}`
        : 'The latest version has been saved to your content storage.',
      color: 'primary'
    })
  } catch (error: any) {
    console.error('Failed to publish content', error)
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

// Workspace-aware submit handler
async function _handleWorkspaceSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }

  try {
    await sendMessage(trimmed, {
      displayContent: trimmed,
      contentId: workspaceContentId.value || conversationContentId.value
    })
    prompt.value = ''
    await loadWorkspacePayload()
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to send that message.'
  }
}

// Update handleRegenerate to be workspace-aware
const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  const text = message.parts[0]?.text?.trim() || ''

  if (!text) {
    toast.add({
      title: 'Cannot regenerate',
      description: 'This message has no text to resend.',
      color: 'error'
    })
    return
  }

  // Workspace-aware: check for section selection
  if (isWorkspaceActive.value && workspaceSections.value.length > 0) {
    if (!selectedSectionId.value) {
      const fallbackSectionId = workspaceSections.value[0]?.id
      if (fallbackSectionId) {
        setActiveSection(fallbackSectionId)
        toast.add({
          title: 'Section auto-selected',
          description: `Regenerating content for "${workspaceSections.value[0]?.title || 'Untitled section'}".`,
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
    await _handleWorkspaceSubmit()
  } else {
    // Non-workspace: simple regenerate
    prompt.value = text
    await handlePromptSubmit(text)
  }
}

async function handleSendAgain(message: ChatMessage) {
  const text = message.parts?.[0]?.text || ''
  if (text) {
    prompt.value = text
    try {
      if (isWorkspaceActive.value) {
        await _handleWorkspaceSubmit()
      } else {
        await handlePromptSubmit(text)
      }
    } catch (error) {
      console.error('Failed to send message again', error)
      toast.add({
        title: 'Send failed',
        description: 'Could not resend the message.',
        color: 'error'
      })
    }
  }
}

async function handleShare(message: ChatMessage) {
  const text = getMessageText(message)
  if (!text.trim()) {
    toast.add({
      title: 'Nothing to share',
      description: 'This message has no text content to share.',
      color: 'error'
    })
    return
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text })
      toast.add({
        title: 'Shared',
        description: 'Message sent to your share target.',
        color: 'primary'
      })
      return
    }
  } catch (error) {
    const isAbortError = error && typeof error === 'object'
      && (
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
        || (error as { name?: string }).name === 'AbortError'
      )

    if (isAbortError) {
      console.info('Share cancelled by user', error)
      toast.add({
        title: 'Share cancelled',
        description: 'No message was shared.',
        color: 'neutral'
      })
      return
    }

    console.warn('Navigator share failed, falling back to copy', error)
  }

  copy(text)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied for sharing.',
    color: 'primary'
  })
}

function openMessageActions(message: ChatMessage, event?: Event) {
  if (event) {
    event.preventDefault()
  }
  messageActionSheetTarget.value = message
  messageActionSheetOpen.value = true
}

function startMessageLongPress(message: ChatMessage, event?: Event) {
  if (message.role !== 'user') {
    return
  }
  if (event) {
    event.stopPropagation()
  }
  clearMessageLongPress()
  longPressStartPosition = getEventCoordinates(event)
  longPressTimeout = setTimeout(() => {
    openMessageActions(message)
  }, LONG_PRESS_DELAY_MS)
}

function clearMessageLongPress() {
  if (longPressTimeout) {
    clearTimeout(longPressTimeout)
    longPressTimeout = null
  }
  longPressStartPosition = null
}

function handleMessageLongPressMove(event: Event) {
  if (!longPressTimeout || !longPressStartPosition) {
    return
  }

  const coordinates = getEventCoordinates(event)
  if (!coordinates) {
    return
  }

  const deltaX = Math.abs(coordinates.x - longPressStartPosition.x)
  const deltaY = Math.abs(coordinates.y - longPressStartPosition.y)

  if (deltaX > LONG_PRESS_MOVE_THRESHOLD_PX || deltaY > LONG_PRESS_MOVE_THRESHOLD_PX) {
    clearMessageLongPress()
  }
}

function handleUserMessageContextMenu(message: ChatMessage, event: Event) {
  if (message.role !== 'user') {
    return
  }
  openMessageActions(message, event)
}

function closeMessageActionSheet() {
  messageActionSheetOpen.value = false
  messageActionSheetTarget.value = null
  clearMessageLongPress()
}

watch(conversationsPayload, (payload) => {
  if (!payload?.conversations)
    return
  const cache = conversationListCache.value
  payload.conversations.forEach((conv: any) => {
    if (conv.id) {
      cache.set(conv.id, conv)
    }
  })
}, { immediate: true, deep: true })

if (import.meta.client) {
  watch(loggedIn, () => {
    debouncedRefreshConversations()
  }, { immediate: true })
}
</script>

<template>
  <div class="w-full py-8 sm:py-12 space-y-8">
    <div class="w-full">
      <div
        v-if="!isWorkspaceActive"
        class="space-y-6 mb-8"
      >
        <h1 class="text-2xl font-semibold text-center">
          What should we write next?
        </h1>
      </div>
      <div class="space-y-8">
        <!-- Error messages are now shown in chat, but keep banner as fallback for non-chat errors -->
        <UAlert
          v-if="errorMessage && !messages.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
          class="w-full"
        />

        <div
          v-if="isWorkspaceActive && activeWorkspaceEntry"
          class="space-y-6 w-full"
        >
          <ClientOnly>
            <div
              v-if="workspaceDetail?.content?.id"
              class="space-y-6"
            >
              <section class="space-y-4 pt-2">
                <div class="space-y-6">
                  <UAlert
                    v-if="errorMessage"
                    color="error"
                    variant="soft"
                    icon="i-lucide-alert-triangle"
                    :description="errorMessage"
                  />

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
                          body-class="text-[15px] leading-6 text-muted-800 dark:text-muted-100"
                        />
                      </template>
                    </UChatMessages>

                    <div class="space-y-2">
                      <PromptComposer
                        v-model="prompt"
                        placeholder="Describe the change you want..."
                        :disabled="
                          isBusy
                            || status === 'submitted'
                            || status === 'streaming'
                            || !selectedSectionId
                        "
                        :status="uiStatus"
                        @submit="_handleWorkspaceSubmit"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <div
              v-else
              class="space-y-6 w-full"
            >
              <div class="text-center text-muted-500">
                Conversation loaded. No content artifacts yet.
              </div>
            </div>
            <template #fallback>
              <div class="space-y-6 w-full" />
            </template>
          </ClientOnly>
        </div>

        <template v-else>
          <div
            v-if="messages.length"
            class="space-y-6 w-full"
          >
            <div class="w-full">
              <UChatMessages
                class="py-4"
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
                    :class="message.role === 'user' ? 'cursor-pointer select-text' : 'select-text'"
                    @touchstart.passive="startMessageLongPress(message, $event)"
                    @touchmove.passive="handleMessageLongPressMove"
                    @touchend.passive="clearMessageLongPress"
                    @touchcancel.passive="clearMessageLongPress"
                    @mousedown="startMessageLongPress(message, $event)"
                    @mousemove="handleMessageLongPressMove"
                    @mouseup="clearMessageLongPress"
                    @mouseleave="clearMessageLongPress"
                    @contextmenu.prevent="handleUserMessageContextMenu(message, $event)"
                  >
                    <ChatMessageContent
                      :message="message"
                      :display-text="getDisplayMessageText(message)"
                    />
                  </div>
                </template>
              </UChatMessages>
            </div>
          </div>

          <div class="w-full space-y-6 mt-8">
            <!-- Main chat input -->
            <div class="w-full flex justify-center">
              <div class="w-full">
                <PromptComposer
                  v-model="prompt"
                  placeholder="Paste a transcript or describe what you need..."
                  :disabled="isBusy || promptSubmitting"
                  :status="promptSubmitting ? 'submitted' : uiStatus"
                  :context-label="isWorkspaceActive ? 'Active content' : undefined"
                  :context-value="activeWorkspaceEntry?.title || null"
                  @submit="handlePromptSubmit"
                >
                  <template #footer>
                    <USelectMenu
                      v-model="mode"
                      :items="[
                        { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
                        { value: 'agent', label: 'Agent', icon: 'i-lucide-bot' }
                      ]"
                      value-key="value"
                      option-attribute="label"
                      variant="ghost"
                      size="sm"
                      :searchable="false"
                    >
                      <template #leading>
                        <UIcon
                          :name="mode === 'agent' ? 'i-lucide-bot' : 'i-lucide-message-circle'"
                          class="w-4 h-4"
                        />
                      </template>
                    </USelectMenu>
                  </template>
                </PromptComposer>
              </div>
            </div>

            <div
              v-if="shouldShowWhatsNew"
              class="w-full mt-8"
            >
              <ChatWhatsNewRow />
            </div>
          </div>
        </template>
      </div>
      <div
        v-if="!isWorkspaceActive && conversationEntries.length > 0"
        class="mt-8"
      >
        <ChatContentList
          :drafts-pending="conversationsPending"
          :content-entries="conversationEntries"
          :archiving-draft-id="archivingConversationId"
          :pending-message="aiThinkingIndicator.message"
          @open-workspace="openConversation"
          @archive-entry="archiveConversation"
          @stop-entry="stopWorkingContent"
        />
      </div>
    </div>

    <UModal
      v-model:open="messageActionSheetOpen"
      :ui="{
        overlay: 'bg-black/60 backdrop-blur-sm',
        wrapper: 'max-w-sm mx-auto',
        content: 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded-2xl shadow-2xl border border-muted-200/80 dark:border-muted-800/70',
        header: 'hidden',
        body: 'p-4 space-y-4',
        footer: 'hidden'
      }"
      @close="closeMessageActionSheet"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted-700 dark:text-muted-200 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {{ messageActionSheetTarget ? getMessageText(messageActionSheetTarget) : '' }}
          </p>
          <div class="flex flex-col gap-2">
            <UButton
              color="primary"
              block
              icon="i-lucide-copy"
              @click="messageActionSheetTarget && handleCopy(messageActionSheetTarget); closeMessageActionSheet()"
            >
              Copy
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              block
              icon="i-lucide-share"
              @click="messageActionSheetTarget && handleShare(messageActionSheetTarget); closeMessageActionSheet()"
            >
              Share
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <QuotaLimitModal
      v-model:open="showQuotaModal"
      :title="quotaModalTitle"
      :limit="quotaModalData?.limit ?? conversationQuotaUsage?.limit ?? null"
      :used="quotaModalData?.used ?? conversationQuotaUsage?.used ?? null"
      :remaining="quotaModalData?.remaining ?? conversationQuotaUsage?.remaining ?? null"
      :plan-label="quotaModalData?.planLabel ?? quotaPlanLabel"
      :message="quotaModalMessage"
      :primary-label="quotaPrimaryLabel"
      @primary="handleQuotaModalPrimary"
      @cancel="handleQuotaModalCancel"
    >
      <template
        v-if="!loggedIn"
        #actions
      >
        <div class="flex flex-col gap-3 pt-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-simple-icons-google"
              class="flex-1 justify-center"
              @click="handleQuotaGoogleSignup"
            >
              Continue with Google
            </UButton>
            <div class="flex-1 text-center sm:text-left">
              <button
                type="button"
                class="text-sm text-primary-400 font-semibold hover:underline"
                @click="handleQuotaEmailSignup"
              >
                Sign up
              </button>
            </div>
          </div>
        </div>
      </template>
    </QuotaLimitModal>
    <BillingUpgradeModal
      v-model:open="showUpgradeModal"
      :organization-id="activeOrgState?.value?.data?.id || undefined"
      @upgraded="handleUpgradeSuccess"
    />
  </div>
</template>
