<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { useClipboard, useDebounceFn } from '@vueuse/core'
import { shallowRef } from 'vue'

import BillingUpgradeModal from '~/components/billing/UpgradeModal.vue'
import { useDraftAction } from '~/composables/useDraftAction'
import { resolveAiThinkingIndicator } from '~/utils/aiThinkingIndicators'
import ChatMessageContent from './ChatMessageContent.vue'
import PromptComposer from './PromptComposer.vue'
import QuotaLimitModal from './QuotaLimitModal.vue'

const props = withDefaults(defineProps<{
  initialDraftId?: string | null // Legacy prop name, maps to contentId
  routeSync?: boolean
}>(), {
  initialDraftId: null,
  routeSync: true
})

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
  agentContext,
  prompt,
  mode,
  currentActivity,
  currentToolName
} = useConversation()
const promptSubmitting = ref(false)
const showQuotaModal = ref(false)
const quotaModalData = ref<{ limit: number | null, used: number | null, remaining: number | null, planLabel: string | null } | null>(null)
const showUpgradeModal = ref(false)
const MAX_USER_MESSAGE_LENGTH = 500
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
      title: conv._computed?.firstArtifactTitle || 'Untitled conversation',
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

  // Preserve unlimited plan semantics when there is no explicit override
  if (!payload && fallback?.unlimited) {
    quotaModalData.value = {
      limit: null,
      used: fallback.used ?? null,
      remaining: fallback.remaining ?? null,
      planLabel: fallback.label ?? quotaPlanLabel.value ?? null
    }
    showQuotaModal.value = true
    return
  }

  const baseLimit = typeof payload?.limit === 'number'
    ? payload.limit
    : (typeof fallback?.limit === 'number' ? fallback.limit : null)
  const normalizedLimit = baseLimit ?? (loggedIn.value ? verifiedConversationLimit.value : guestConversationLimit.value)

  // Derive usedValue from payload, fallback, or remaining if provided, otherwise default to 0
  let usedValue: number | null = null
  if (typeof payload?.used === 'number') {
    usedValue = payload.used
  } else if (typeof fallback?.used === 'number') {
    usedValue = fallback.used
  } else if (typeof payload?.remaining === 'number' && baseLimit !== null) {
    usedValue = Math.max(0, baseLimit - payload.remaining)
  } else if (typeof fallback?.remaining === 'number' && baseLimit !== null) {
    usedValue = Math.max(0, baseLimit - fallback.remaining)
  }

  const finalUsed = usedValue ?? 0
  const finalLimit = baseLimit ?? normalizedLimit

  // Calculate remaining: prefer explicit remaining, otherwise compute from limit and used
  const remainingValue = payload?.remaining ?? fallback?.remaining ?? (finalLimit !== null ? Math.max(0, finalLimit - finalUsed) : null)

  quotaModalData.value = {
    limit: finalLimit,
    used: finalUsed,
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

const routeContentId = computed(() => normalizeContentId(route.query.content || route.query.draft)) // Support both 'content' and legacy 'draft' query param
const standaloneContentId = computed(() => props.initialDraftId ?? routeContentId.value ?? null)

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
    // Remove legacy 'draft' param if it exists
    delete nextQuery.draft
  } else {
    delete nextQuery.content
    delete nextQuery.draft
  }
  try {
    await router.replace({ query: nextQuery })
  } catch (error) {
    console.warn('Failed to update content route', error)
  }
}

const initialContentId = computed(() => (props.routeSync ? routeContentId.value : standaloneContentId.value) ?? null)

await syncWorkspace(initialContentId.value)

const activateWorkspace = async (conversationId: string | null) => {
  if (props.routeSync) {
    await updateContentRoute(conversationId)
  } else {
    await syncWorkspace(conversationId)
  }
}

const openConversation = async (entry: { id: string }) => {
  // Open conversation by conversationId (not contentId)
  await activateWorkspace(entry.id)
}

const _handleResetConversation = () => {
  prompt.value = ''
  resetConversation()
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
}

if (props.routeSync) {
  watch(routeContentId, (contentId) => {
    scheduleSyncWorkspace(contentId ?? null)
  })
} else {
  watch(standaloneContentId, (contentId) => {
    if (!import.meta.client) {
      return
    }
    scheduleSyncWorkspace(contentId ?? null)
  })
}

onBeforeUnmount(() => {
  clearMessageLongPress()
})

const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  const text = message.parts[0]?.text || ''
  prompt.value = text
  await handlePromptSubmit(text)
}

function getMessageText(message: ChatMessage) {
  return message.parts[0]?.text || ''
}

function getDisplayMessageText(message: ChatMessage) {
  const text = getMessageText(message)
  if (message.role === 'user' && text.length > MAX_USER_MESSAGE_LENGTH) {
    return `${text.slice(0, MAX_USER_MESSAGE_LENGTH)}...`
  }
  return text
}

function handleCopy(message: ChatMessage) {
  const text = getMessageText(message)
  copy(text)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied successfully.',
    color: 'primary'
  })
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
            <ChatConversationWorkspace
              v-if="workspaceDetail?.content?.id"
              :content-id="workspaceDetail.content.id"
              :organization-slug="workspaceDetail.content.slug || activeOrgState?.value?.data?.slug || null"
              :initial-payload="workspaceDetail"
              :show-back-button="true"
              :back-to="null"
              @close="closeWorkspace"
            />
            <div
              v-else-if="workspaceDetail?.conversation"
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
                      onClick: (e, message) => {
                        const text = (message as ChatMessage).parts[0]?.text || ''
                        if (text) {
                          handlePromptSubmit(text)
                        }
                      }
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

            <!-- Agent Context Display -->
            <div
              v-if="agentContext && (agentContext.readySources?.length || agentContext.ingestFailures?.length)"
              class="w-full space-y-4"
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
                      v-for="(source, index) in agentContext.readySources"
                      :key="source.id || source.title || `source-${index}`"
                      class="text-sm"
                    >
                      <strong>{{ source.title || 'Untitled source' }}</strong>
                      <span
                        v-if="source.sourceType"
                        class="text-surface-500"
                      > ({{ source.sourceType.replace('_', ' ') }})</span>
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
                      {{ failure?.content || 'Unknown error' }}
                    </div>
                  </div>
                </template>
              </UAlert>
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
                        { value: 'agent', label: 'Agent', icon: 'i-lucide-bot' },
                        { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' }
                      ]"
                      value-key="value"
                      option-attribute="label"
                      variant="ghost"
                      size="sm"
                    >
                      <template #leading>
                        <UIcon
                          :name="mode === 'agent' ? 'i-lucide-bot' : 'i-lucide-message-circle'"
                          class="w-4 h-4"
                        />
                      </template>
                    </USelectMenu>
                  </template>
                  <template #submit>
                    <UChatPromptSubmit
                      :status="promptSubmitting ? 'submitted' : uiStatus"
                      submitted-color="primary"
                      submitted-variant="solid"
                      streaming-color="primary"
                      streaming-variant="solid"
                    />
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
