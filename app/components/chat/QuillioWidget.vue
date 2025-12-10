<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { useClipboard, useDebounceFn } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'

import BillingUpgradeModal from '~/components/billing/UpgradeModal.vue'
import ChatMessageContent from './ChatMessageContent.vue'
import FilesChanged from './FilesChanged.vue'
import PromptComposer from './PromptComposer.vue'
import QuotaLimitModal from './QuotaLimitModal.vue'

interface ContentConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

// Props for embedding the widget
interface Props {
  contentId?: string | null // Link chat to specific content
  conversationId?: string | null // Resume existing conversation
  initialMode?: 'chat' | 'agent' // Default chat mode
}

const props = withDefaults(defineProps<Props>(), {
  contentId: null,
  conversationId: null,
  initialMode: 'chat'
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
  conversationId: activeConversationId,
  resetConversation,
  prompt,
  mode,
  hydrateConversation
} = useConversation()

// Set initial mode from props
if (props.initialMode) {
  mode.value = props.initialMode
}

const promptSubmitting = ref(false)
const showQuotaModal = ref(false)
const quotaModalData = ref<{ limit: number | null, used: number | null, remaining: number | null, planLabel: string | null } | null>(null)
const showUpgradeModal = ref(false)
const showAgentModeLoginModal = ref(false)
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

const archivingConversationId = ref<string | null>(null)
const conversationQuotaState = useState<ConversationQuotaUsagePayload | null>('conversation-quota-usage', () => null)

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
  refresh: refreshConversations
} = await useFetch<ConversationListResponse>('/api/conversations', {
  lazy: true, // Don't block page load
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
      lastMessage: conv._computed?.lastMessage || null
    }
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
})

// Filter out archived conversations - show only active/completed
const conversationEntries = computed(() => {
  return fetchedConversationEntries.value.filter((entry) => {
    const status = (entry.status || '').toLowerCase().trim()
    return status !== 'archived'
  })
})

// Convert conversations to UNavigationMenu format (array of arrays for groups)
const conversationMenuItems = computed(() => {
  const items = conversationEntries.value.map(conv => ({
    label: conv.title,
    to: `/conversations/${conv.id}`,
    badge: conv.status === 'pending' ? 'pending' : undefined
  }))
  // Return as array of arrays (groups) like other menus
  return items.length > 0 ? [items] : []
})

// Share conversation menu items via shared state (accessible from layout)
const conversationMenuItemsState = useState<any[][]>('conversation-menu-items', () => [])
watch(conversationMenuItems, (items) => {
  conversationMenuItemsState.value = items
}, { immediate: true })

const uiStatus = computed(() => status.value)

// Tool progress is now shown inline as message parts, no need for placeholder
const displayMessages = computed<ChatMessage[]>(() => messages.value)
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
  // Wait for modal to close and DOM to update before refreshing
  await nextTick()
  try {
    await refreshActiveOrg()
    await refreshConversations()
  } catch (error) {
    // Silently handle errors during refresh to prevent crashes
    // Component may be unmounting or in a transitional state
    console.error('Error refreshing after upgrade:', error)
  }
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

const handleAgentModeGoogleSignup = () => {
  showAgentModeLoginModal.value = false
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

const handleAgentModeEmailSignup = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signup?redirect=${encodeURIComponent(redirect)}`)
}

const handleAgentModeSignIn = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signin?redirect=${encodeURIComponent(redirect)}`)
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
    prompt.value = ''
  } finally {
    promptSubmitting.value = false
  }
}

// Get conversationId from route params (for /conversations/[id] route)
const routeConversationId = computed(() => {
  const id = route.params.id
  if (Array.isArray(id)) {
    return id[0] || null
  }
  return id || null
})

// Effective conversation ID: prioritize prop, then route, then active conversation
const conversationId = computed(() => {
  return props.conversationId || routeConversationId.value || activeConversationId.value
})

// Simple UUID validation (matches server-side validation)
const isValidUUID = (id: string | null): boolean => {
  if (!id) {
    return false
  }
  // UUID v7 format: 8-4-4-4-12 hex digits
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

const loadConversationMessages = async (conversationId: string) => {
  if (!conversationId) {
    return
  }

  // Skip loading if conversationId is "new" or not a valid UUID
  if (conversationId === 'new' || !isValidUUID(conversationId)) {
    return
  }

  try {
    const messagesResponse = await $fetch<{ data: ContentConversationMessage[] }>(`/api/conversations/${conversationId}/messages`)

    // Convert ContentConversationMessage to ChatResponse format
    const convertedMessages = (messagesResponse.data || []).map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      parts: msg.content ? [{ type: 'text' as const, text: msg.content }] : [],
      payload: msg.payload,
      createdAt: msg.createdAt
    }))

    hydrateConversation({
      conversationId,
      messages: convertedMessages
    })
  } catch (error) {
    console.error('Unable to load conversation messages', error)
    toast.add({
      title: 'Failed to load messages',
      description: 'Unable to load conversation history. Please try refreshing.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  }
}

// Load conversation from prop or route param when component mounts or changes
watch([() => props.conversationId, routeConversationId], async ([propId, routeId]) => {
  const targetId = propId || routeId

  if (targetId && targetId !== activeConversationId.value) {
    if (isValidUUID(targetId)) {
      activeConversationId.value = targetId
      await loadConversationMessages(targetId)
    }
  } else if (!targetId && activeConversationId.value) {
    // No conversation specified, reset
    activeConversationId.value = null
    resetConversation()
  }
}, { immediate: true })

// Watch composable conversationId - when chat creates/updates conversation, navigate to it
watch(activeConversationId, (value, previous) => {
  if (!value || value === previous)
    return

  // Only navigate if not embedded (no contentId prop) and route doesn't match
  if (!props.contentId && value !== routeConversationId.value) {
    router.push(`/conversations/${value}`)
  }

  // Refresh conversations to ensure new conversation appears in list
  const alreadyPresent = fetchedConversationEntries.value.some(entry => entry.id === value)

  if (!alreadyPresent) {
    debouncedRefreshConversations()
  }
})

const closeConversation = async () => {
  router.push('/conversations')
  resetConversation()
}

// Archive via context menu or other UI - not used in navigation menu
const _archiveConversation = async (entry: { id: string, title?: string | null }) => {
  if (!entry?.id || archivingConversationId.value === entry.id)
    return

  archivingConversationId.value = entry.id

  try {
    await $fetch(`/api/conversations/${entry.id}`, {
      method: 'DELETE'
    })

    updateLocalConversationStatus(entry.id, 'archived')

    if (activeConversationId.value === entry.id) {
      router.push('/conversations')
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

// Keep for potential future use (e.g., back button in UI)
function _handleBackNavigation() {
  if (activeConversationId.value) {
    closeConversation()
  } else {
    router.push('/')
  }
}

onBeforeUnmount(() => {
  clearMessageLongPress()
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

  prompt.value = text
  await handlePromptSubmit(text)
}

async function handleSendAgain(message: ChatMessage) {
  const text = message.parts?.[0]?.text || ''
  if (text) {
    prompt.value = text
    try {
      await handlePromptSubmit(text)
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

  // Watch mode changes - block agent mode for anonymous users
  watch(mode, (newMode) => {
    if (newMode === 'agent' && !loggedIn.value) {
      // Reset to chat mode
      mode.value = 'chat'
      // Show login prompt
      showAgentModeLoginModal.value = true
    }
  })
}
</script>

<template>
  <div class="w-full h-full flex flex-col py-4 px-4 sm:px-6">
    <div class="w-full">
      <div class="space-y-8">
        <!-- Welcome message -->
        <div
          v-if="!messages.length && !conversationId && !isBusy && !promptSubmitting"
          class="space-y-6 mb-8"
        >
          <h1 class="text-2xl font-semibold text-center">
            What would you like to write today?
          </h1>
        </div>

        <!-- Error banner -->
        <UAlert
          v-if="errorMessage && !messages.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
          class="w-full"
        />

        <!-- Messages -->
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

          <!-- Files Changed Summary -->
          <FilesChanged
            v-if="conversationId"
            :conversation-id="conversationId"
          />
        </div>

        <!-- Main chat input - always visible -->
        <div class="w-full space-y-6 mt-8">
          <div class="w-full flex justify-center">
            <div class="w-full">
              <PromptComposer
                v-model="prompt"
                placeholder="Paste a transcript or describe what you need..."
                :disabled="isBusy || promptSubmitting"
                :status="promptSubmitting ? 'submitted' : uiStatus"
                @submit="handlePromptSubmit"
              >
                <template #footer>
                  <UTooltip
                    v-if="!loggedIn"
                    text="Sign in to unlock agent mode"
                  >
                    <USelectMenu
                      v-model="mode"
                      :items="[
                        { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
                        { value: 'agent', label: 'Agent', icon: 'i-lucide-bot', disabled: !loggedIn }
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
                          :class="{ 'opacity-50': mode === 'agent' && !loggedIn }"
                        />
                      </template>
                    </USelectMenu>
                  </UTooltip>
                  <USelectMenu
                    v-else
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

          <!-- What's New Section - Below Input -->
          <div
            v-if="!messages.length && !conversationId && !isBusy && !promptSubmitting"
            class="space-y-4 pt-4"
          >
            <div class="flex items-center gap-2 justify-center text-xs font-semibold text-muted-500 uppercase tracking-wider">
              <UIcon
                name="i-lucide-sparkles"
                class="w-3 h-3"
              />
              <span>What's new in Quillio</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
              <button
                type="button"
                class="text-left p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
              >
                <div class="flex items-start gap-3">
                  <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30 transition-colors">
                    <UIcon
                      name="i-lucide-brain-circuit"
                      class="w-5 h-5"
                    />
                  </div>
                  <div>
                    <h3 class="font-medium text-sm">
                      Deep Reasoning
                    </h3>
                    <p class="text-xs text-muted-500 mt-1">
                      Ask complex questions requiring multi-step analysis.
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                class="text-left p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
              >
                <div class="flex items-start gap-3">
                  <div class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                    <UIcon
                      name="i-lucide-file-code"
                      class="w-5 h-5"
                    />
                  </div>
                  <div>
                    <h3 class="font-medium text-sm">
                      Artifacts
                    </h3>
                    <p class="text-xs text-muted-500 mt-1">
                      Generate and edit code, documents, and diagrams visually.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
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

    <!-- Agent Mode Login Modal -->
    <UModal
      v-model:open="showAgentModeLoginModal"
      title="Sign in to unlock agent mode"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted-600 dark:text-muted-400">
            Agent mode requires authentication to create and save content. Sign in to unlock the full power of AI-assisted content creation.
          </p>

          <div class="flex flex-col gap-3 pt-4">
            <UButton
              color="primary"
              block
              icon="i-simple-icons-google"
              @click="handleAgentModeGoogleSignup"
            >
              Continue with Google
            </UButton>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="handleAgentModeSignIn"
              >
                Sign In
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="handleAgentModeEmailSignup"
              >
                Sign Up
              </UButton>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              block
              @click="showAgentModeLoginModal = false"
            >
              Maybe later
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
