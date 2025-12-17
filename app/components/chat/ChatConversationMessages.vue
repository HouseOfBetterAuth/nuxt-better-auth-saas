<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { ChatStatus } from '~/composables/useConversation'
import { computed, onBeforeUnmount, ref } from 'vue'

import ChatMessageContent from './ChatMessageContent.vue'
import FilesChanged from './FilesChanged.vue'

interface Props {
  messages: ChatMessage[]
  displayMessages: ChatMessage[]
  conversationId: string | null
  status: ChatStatus
  uiStatus: ChatStatus
  errorMessage: string | null
  isBusy: boolean
  promptSubmitting: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'copy', message: ChatMessage): void
  (event: 'regenerate', message: ChatMessage): void
  (event: 'sendAgain', message: ChatMessage): void
  (event: 'share', message: ChatMessage): void
}>()

const LONG_PRESS_DELAY_MS = 500
const LONG_PRESS_MOVE_THRESHOLD_PX = 10

const messageActionSheetOpen = ref(false)
const messageActionSheetTarget = ref<ChatMessage | null>(null)
let longPressTimeout: ReturnType<typeof setTimeout> | null = null
let longPressStartPosition: { x: number, y: number } | null = null

const showLoadingSkeleton = computed(() =>
  !props.messages.length && props.conversationId && props.status === 'ready' && !props.errorMessage
)

const showWelcomeState = computed(() =>
  !props.messages.length && !props.conversationId && !props.isBusy && !props.promptSubmitting
)

const assistantActions = computed(() => [
  {
    label: 'Copy',
    icon: 'i-lucide-copy',
    onClick: (_event: Event, message: ChatMessage) => emit('copy', message)
  },
  {
    label: 'Regenerate',
    icon: 'i-lucide-rotate-ccw',
    onClick: (_event: Event, message: ChatMessage) => emit('regenerate', message)
  }
])

const userActions = computed(() => [
  {
    label: 'Copy',
    icon: 'i-lucide-copy',
    onClick: (_event: Event, message: ChatMessage) => emit('copy', message)
  },
  {
    label: 'Send again',
    icon: 'i-lucide-send',
    onClick: (_event: Event, message: ChatMessage) => emit('sendAgain', message)
  }
])

function getEventCoordinates(event?: Event | null) {
  if (!event) {
    return null
  }

  if ('touches' in event) {
    const touchEvent = event as TouchEvent
    const touch = touchEvent.touches?.[0]
    if (!touch) {
      return null
    }
    return { x: touch.clientX, y: touch.clientY }
  }

  if ('clientX' in event && 'clientY' in event) {
    const mouseEvent = event as MouseEvent
    return { x: mouseEvent.clientX, y: mouseEvent.clientY }
  }

  return null
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

function getMessageText(message: ChatMessage | null) {
  if (!message) {
    return ''
  }
  return message.parts
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join(' ')
}

function emitActionSheetAction(type: 'copy' | 'share') {
  const target = messageActionSheetTarget.value
  if (!target) {
    return
  }
  emit(type, target)
  closeMessageActionSheet()
}

onBeforeUnmount(() => {
  clearMessageLongPress()
})
</script>

<template>
  <div class="space-y-8">
    <div
      v-if="showLoadingSkeleton"
      class="space-y-4"
    >
      <USkeleton class="h-20 w-full rounded-lg" />
      <USkeleton class="h-32 w-3/4 rounded-lg" />
      <USkeleton class="h-24 w-full rounded-lg" />
    </div>

    <div
      v-if="showWelcomeState"
      class="flex items-center justify-center min-h-[60vh] lg:hidden"
    >
      <h1 class="text-2xl sm:text-3xl font-semibold text-center px-4">
        What would you like to write today?
      </h1>
    </div>

    <UAlert
      v-if="errorMessage && !messages.length"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="errorMessage"
      class="w-full"
    />

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
          :assistant="{ actions: assistantActions }"
          :user="{ actions: userActions }"
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
                :display-text="message.parts?.[0]?.text || ''"
              />
            </div>
          </template>
        </UChatMessages>
      </div>

      <FilesChanged
        v-if="conversationId"
        :conversation-id="conversationId"
      />
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
            {{ getMessageText(messageActionSheetTarget) }}
          </p>
          <div class="flex flex-col gap-2">
            <UButton
              color="primary"
              block
              icon="i-lucide-copy"
              @click="emitActionSheetAction('copy')"
            >
              Copy
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              block
              icon="i-lucide-share"
              @click="emitActionSheetAction('share')"
            >
              Share
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
