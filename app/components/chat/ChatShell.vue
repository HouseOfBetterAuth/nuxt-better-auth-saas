<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { useClipboard, useElementVisibility } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { useConversationList } from '~/composables/useConversationList'
import ChatConversationMessages from './ChatConversationMessages.vue'
import PromptComposer from './PromptComposer.vue'

const props = withDefaults(defineProps<{
  contentId?: string | null
  conversationId?: string | null
  initialMode?: 'chat' | 'agent'
}>(), {
  contentId: null,
  conversationId: null,
  initialMode: 'chat'
})

const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const { loggedIn, signIn } = useAuth()

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
  hydrateConversation,
  getCachedMessagesMeta
} = useConversation()

if (props.initialMode)
  mode.value = props.initialMode
if (!loggedIn.value && mode.value === 'agent')
  mode.value = 'chat'

watch([loggedIn, () => mode.value], ([isLoggedIn, currentMode]) => {
  if (!isLoggedIn && currentMode === 'agent')
    mode.value = 'chat'
}, { immediate: true })

const modeItems = computed(() => [
  { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { value: 'agent', label: 'Agent', icon: 'i-lucide-bot', disabled: !loggedIn.value }
])

const promptSubmitting = ref(false)
const showAgentModeLoginModal = ref(false)
const { copy } = useClipboard()
const toast = useToast()
const conversationList = useConversationList({ pageSize: 40 })
const chatContainerRef = ref<HTMLElement | null>(null)
const chatVisible = useElementVisibility(chatContainerRef)
const pendingConversationLoad = ref<string | null>(null)
const conversationLoadToken = ref(0)
conversationList.loadInitial().catch(() => {})

const uiStatus = computed(() => status.value)
const displayMessages = computed<ChatMessage[]>(() => messages.value)

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
  const target = localePath({ path: '/signup', query: { redirect } })
  router.push(target)
}

const handleAgentModeSignIn = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  const target = localePath({ path: '/signin', query: { redirect } })
  router.push(target)
}

const handlePromptSubmit = async (value?: string) => {
  const input = typeof value === 'string' ? value : prompt.value
  const trimmed = input.trim()
  if (!trimmed)
    return

  promptSubmitting.value = true
  prompt.value = ''
  try {
    await sendMessage(trimmed)
  } catch (error) {
    prompt.value = trimmed
    console.error('Failed to send prompt', error)
    toast.add({
      title: 'Unable to send message',
      description: error instanceof Error ? error.message : 'Please try again.',
      color: 'error'
    })
    return
  } finally {
    promptSubmitting.value = false
  }
}

const routeConversationId = computed(() => {
  const id = route.params.id
  return Array.isArray(id) ? (id[0] || null) : (id || null)
})

const conversationId = computed(() => {
  return props.conversationId || routeConversationId.value || activeConversationId.value
})
const isWelcomeState = computed(() => {
  return messages.value.length === 0
    && !conversationId.value
    && !isBusy.value
    && !promptSubmitting.value
})
const routeNewConversation = computed(() => {
  const flag = route.query.new
  if (Array.isArray(flag))
    return flag.length > 0
  return typeof flag !== 'undefined'
})

const startNewConversation = () => {
  pendingConversationLoad.value = null
  activeConversationId.value = null
  resetConversation()
  prompt.value = ''
}

const clearNewConversationFlag = () => {
  if (!route.query.new)
    return
  const nextQuery = { ...route.query }
  delete nextQuery.new
  router.replace({ path: route.path, query: nextQuery }).catch(() => {})
}

const isValidUUID = (id: string | null): boolean => {
  if (!id)
    return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

interface ContentConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

const loadConversationMessages = async (conversationId: string, options?: { force?: boolean }) => {
  if (!conversationId || conversationId === 'new' || !isValidUUID(conversationId))
    return

  const cached = getCachedMessagesMeta(conversationId)
  if (cached) {
    hydrateConversation({ conversationId, messages: cached.messages }, { skipCache: true })
  }

  const shouldFetch = options?.force || !cached || cached.isStale
  if (!shouldFetch)
    return

  const myToken = ++conversationLoadToken.value

  try {
    const messagesResponse = await $fetch<{ data: ContentConversationMessage[] }>(`/api/conversations/${conversationId}/messages`)
    if (myToken !== conversationLoadToken.value || conversationId !== activeConversationId.value)
      return
    const converted = (messagesResponse.data || []).map((msg) => {
      const createdAt = msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt)
      const text = msg.content || ''
      return {
        id: msg.id,
        role: msg.role,
        parts: [{ type: 'text' as const, text }],
        createdAt,
        payload: msg.payload ?? null
      }
    }) as ChatMessage[]

    hydrateConversation({ conversationId, messages: converted })
  } catch (error) {
    if (!cached) {
      console.error('Unable to load conversation messages', error)
      toast.add({
        title: 'Failed to load messages',
        description: 'Unable to load conversation history. Please try refreshing.',
        color: 'error',
        icon: 'i-lucide-alert-triangle'
      })
    }
  }
}

const requestConversationMessages = async (conversationId: string, options?: { force?: boolean }) => {
  if (!chatVisible.value) {
    // Only update if not already pending or if it's a different conversation
    if (!pendingConversationLoad.value || pendingConversationLoad.value !== conversationId) {
      pendingConversationLoad.value = conversationId
    }
    return
  }
  pendingConversationLoad.value = null
  await loadConversationMessages(conversationId, options)
}

watch([() => props.conversationId, routeConversationId], async ([propId, routeId]) => {
  const targetId = propId || routeId

  if (targetId && targetId !== activeConversationId.value) {
    if (isValidUUID(targetId)) {
      activeConversationId.value = targetId
      try {
        await requestConversationMessages(targetId)
      } catch (error) {
        console.error('Failed to load conversation history', error)
      }
    }
  } else if (!targetId && activeConversationId.value) {
    pendingConversationLoad.value = null
    activeConversationId.value = null
    resetConversation()
  }
}, { immediate: true })

watch(routeNewConversation, (isNew) => {
  if (!isNew)
    return
  startNewConversation()
  clearNewConversationFlag()
}, { immediate: true })

watch(chatVisible, (visible) => {
  if (!visible || !pendingConversationLoad.value)
    return
  const target = pendingConversationLoad.value
  pendingConversationLoad.value = null
  // Only load if this conversation is still active
  if (target !== activeConversationId.value)
    return
  loadConversationMessages(target).catch((error) => {
    console.error('Failed to load conversation after becoming visible', error)
  })
})

watch(activeConversationId, (value, previous) => {
  if (!value || value === previous)
    return

  if (!props.contentId && value !== routeConversationId.value)
    router.push(localePath(`/conversations/${value}`))

  if (!conversationList.hasConversation(value))
    conversationList.refresh().catch(() => {})
})

const getMessageText = (message: ChatMessage) => {
  return message.parts[0]?.text || ''
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
  if (isBusy.value)
    return

  const text = message.parts[0]?.text?.trim() || ''
  if (!text) {
    toast.add({
      title: 'Cannot regenerate',
      description: 'This message has no text to resend.',
      color: 'error'
    })
    return
  }

  await handlePromptSubmit(text)
}

async function handleSendAgain(message: ChatMessage) {
  if (isBusy.value)
    return

  const text = message.parts?.[0]?.text || ''
  if (!text)
    return

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
        description: 'Message sent to your share target.'
      })
      return
    }
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    if (isAbort) {
      toast.add({
        title: 'Share cancelled',
        color: 'neutral'
      })
      return
    }
    console.warn('Navigator share failed, falling back to copy', error)
  }

  try {
    await copy(text)
    toast.add({
      title: 'Copied to clipboard',
      description: 'Message copied for sharing.',
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

if (import.meta.client) {
  watch(loggedIn, (value, previous) => {
    if (value === previous)
      return
    conversationList.reset()
    conversationList.loadInitial().catch(() => {})
  })

  watch(mode, (newMode) => {
    if (newMode === 'agent' && !loggedIn.value) {
      mode.value = 'chat'
      showAgentModeLoginModal.value = true
    }
  })
}
</script>

<template>
  <div
    ref="chatContainerRef"
    class="w-full h-full flex flex-col py-4 px-4 sm:px-6 pb-40 lg:pb-4"
  >
    <template v-if="isWelcomeState">
      <div class="w-full flex-1 flex flex-col justify-center">
        <div class="space-y-8 w-full max-w-3xl mx-auto">
          <ChatConversationMessages
            :messages="messages"
            :display-messages="displayMessages"
            :conversation-id="conversationId"
            :status="status"
            :ui-status="uiStatus"
            :error-message="errorMessage"
            :is-busy="isBusy"
            :prompt-submitting="promptSubmitting"
            @copy="handleCopy"
            @regenerate="handleRegenerate"
            @send-again="handleSendAgain"
            @share="handleShare"
          />
        </div>
      </div>

      <div class="w-full flex flex-col justify-center fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm z-40 lg:static lg:bg-white lg:dark:bg-gray-900 lg:backdrop-blur-none px-4 sm:px-6">
        <div class="w-full max-w-3xl mx-auto">
          <PromptComposer
            v-model="prompt"
            placeholder="Paste a transcript or describe what you need..."
            :disabled="isBusy || promptSubmitting"
            :status="promptSubmitting ? 'submitted' : uiStatus"
            @submit="handlePromptSubmit"
          >
            <template #footer>
              <component
                :is="!loggedIn ? 'UTooltip' : 'div'"
                v-bind="!loggedIn ? { text: 'Sign in to unlock agent mode' } : {}"
              >
                <UInputMenu
                  v-model="mode"
                  :items="modeItems"
                  value-key="value"
                  label-key="label"
                  variant="ghost"
                  size="sm"
                  ignore-filter
                  readonly
                  open-on-click
                >
                  <template #leading>
                    <UIcon
                      :name="mode === 'agent' ? 'i-lucide-bot' : 'i-lucide-message-circle'"
                      class="w-4 h-4"
                      :class="{ 'opacity-50': mode === 'agent' && !loggedIn }"
                    />
                  </template>
                </UInputMenu>
              </component>
            </template>
          </PromptComposer>

          <i18n-t
            v-if="!loggedIn"
            keypath="global.legal.chatDisclaimer"
            tag="p"
            class="text-xs text-muted-600 dark:text-muted-400 text-center mt-2"
          >
            <template #terms>
              <NuxtLink
                :to="localePath('/terms')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ $t('global.legal.terms') }}
              </NuxtLink>
            </template>
            <template #privacy>
              <NuxtLink
                :to="localePath('/privacy')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ $t('global.legal.privacyPolicy') }}
              </NuxtLink>
            </template>
          </i18n-t>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="w-full flex-1 flex flex-col justify-end lg:justify-start">
        <div class="space-y-8 w-full max-w-3xl mx-auto">
          <ChatConversationMessages
            :messages="messages"
            :display-messages="displayMessages"
            :conversation-id="conversationId"
            :status="status"
            :ui-status="uiStatus"
            :error-message="errorMessage"
            :is-busy="isBusy"
            :prompt-submitting="promptSubmitting"
            @copy="handleCopy"
            @regenerate="handleRegenerate"
            @send-again="handleSendAgain"
            @share="handleShare"
          />
        </div>
      </div>

      <div class="w-full flex flex-col justify-center fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm z-40 lg:static lg:bg-white lg:dark:bg-gray-900 lg:backdrop-blur-none px-4 sm:px-6">
        <div class="w-full max-w-3xl mx-auto">
          <PromptComposer
            v-model="prompt"
            placeholder="Paste a transcript or describe what you need..."
            :disabled="isBusy || promptSubmitting"
            :status="promptSubmitting ? 'submitted' : uiStatus"
            @submit="handlePromptSubmit"
          >
            <template #footer>
              <component
                :is="!loggedIn ? 'UTooltip' : 'div'"
                v-bind="!loggedIn ? { text: 'Sign in to unlock agent mode' } : {}"
              >
                <UInputMenu
                  v-model="mode"
                  :items="modeItems"
                  value-key="value"
                  label-key="label"
                  variant="ghost"
                  size="sm"
                  ignore-filter
                  readonly
                  open-on-click
                >
                  <template #leading>
                    <UIcon
                      :name="mode === 'agent' ? 'i-lucide-bot' : 'i-lucide-message-circle'"
                      class="w-4 h-4"
                      :class="{ 'opacity-50': mode === 'agent' && !loggedIn }"
                    />
                  </template>
                </UInputMenu>
              </component>
            </template>
          </PromptComposer>

          <i18n-t
            v-if="!loggedIn"
            keypath="global.legal.chatDisclaimer"
            tag="p"
            class="text-xs text-muted-600 dark:text-muted-400 text-center mt-2"
          >
            <template #terms>
              <NuxtLink
                :to="localePath('/terms')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ $t('global.legal.terms') }}
              </NuxtLink>
            </template>
            <template #privacy>
              <NuxtLink
                :to="localePath('/privacy')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ $t('global.legal.privacyPolicy') }}
              </NuxtLink>
            </template>
          </i18n-t>
        </div>
      </div>
    </template>

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
