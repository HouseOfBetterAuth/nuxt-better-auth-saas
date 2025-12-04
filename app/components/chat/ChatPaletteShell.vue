<script setup lang="ts">
import type { ChatActionSuggestion, ChatMessage } from '#shared/utils/types'
import { useClipboard } from '@vueuse/core'
import { computed, ref } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error' | 'idle'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  open: boolean
  status?: ChatStatus
  title?: string
  placeholder?: string
  disabled?: boolean
  actions?: ChatActionSuggestion[]
}>(), {
  status: 'ready',
  title: 'Codex Chat',
  placeholder: 'Ask anything…',
  disabled: false,
  actions: () => []
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submit': [value: string]
  'action': [value: ChatActionSuggestion]
  'regenerate': [message: ChatMessage]
}>()

const prompt = ref('')
const { copy } = useClipboard()
const toast = useToast()

const uiStatus = computed(() => {
  return props.status === 'idle' ? 'ready' : props.status
})

function handleSubmit(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return
  }
  emit('submit', trimmed)
  prompt.value = ''
}

function handleAction(action: ChatActionSuggestion) {
  emit('action', action)
}

function handleCopy(message: ChatMessage) {
  const text = message.parts[0]?.text || ''
  if (!text) {
    toast.add({
      title: 'Nothing to copy',
      description: 'This message has no text content.',
      color: 'error'
    })
    return
  }
  try {
    copy(text)
    toast.add({
      title: 'Copied to clipboard',
      description: 'Message copied successfully.',
      color: 'primary'
    })
  } catch (error) {
    console.error('Failed to copy message', error)
    toast.add({
      title: 'Copy failed',
      description: 'Could not copy to clipboard.',
      color: 'error'
    })
  }
}

function handleRegenerate(message: ChatMessage) {
  emit('regenerate', message)
}
</script>

<template>
  <USlideover
    :open="open"
    :title="title"
    :content="{ class: 'max-w-xl w-full' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <UChatPalette>
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
                onClick: (e, message) => {
                  const text = (message as ChatMessage).parts[0]?.text || ''
                  if (text) {
                    emit('submit', text)
                  }
                }
              }
            ]
          }"
        >
          <template #content="{ message }">
            <div class="whitespace-pre-line">
              {{ message.parts[0]?.text }}
            </div>
          </template>
        </UChatMessages>

        <div
          v-if="actions.length"
          class="px-4 py-3"
        >
          <div class="mb-2 text-sm font-medium">
            Suggested actions
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="(action, index) in actions"
              :key="`${action.type}-${action.sourceContentId ?? 'none'}-${index}`"
              variant="soft"
              size="sm"
              icon="i-lucide-wand-sparkles"
              :disabled="disabled"
              @click="handleAction(action)"
            >
              {{ action.label || 'Start a draft' }}
            </UButton>
          </div>
        </div>

        <template #prompt>
          <UChatPrompt
            v-model="prompt"
            :placeholder="placeholder"
            :disabled="disabled"
            variant="subtle"
            @submit="handleSubmit(prompt)"
          >
            <UChatPromptSubmit
              :status="uiStatus"
              color="neutral"
            />
          </UChatPrompt>
        </template>
      </UChatPalette>
    </template>
  </USlideover>
</template>
