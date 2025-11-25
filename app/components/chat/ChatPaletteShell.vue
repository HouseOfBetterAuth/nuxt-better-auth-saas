<script setup lang="ts">
import type { ChatActionSuggestion, ChatMessage } from '#shared/utils/types'
import { computed, ref } from 'vue'
import ChatMessagesList from './ChatMessagesList.vue'

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
}>()

const prompt = ref('')

const promptStatus = computed(() => {
  if (props.status === 'idle') {
    return 'ready'
  }
  return props.status
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
</script>

<template>
  <USlideover
    :open="open"
    :title="title"
    :content="{ class: 'max-w-xl w-full' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <UChatPalette class="flex h-full flex-col">
        <div class="flex-1 overflow-y-auto px-2 py-4">
          <ChatMessagesList
            :messages="messages"
            :status="status"
            class="h-full"
          />
        </div>

        <div
          v-if="actions.length"
          class="border-t border-border px-4 py-3"
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
            @submit="handleSubmit(prompt)"
          >
            <UChatPromptSubmit :status="promptStatus" />
          </UChatPrompt>
        </template>
      </UChatPalette>
    </template>
  </USlideover>
</template>
