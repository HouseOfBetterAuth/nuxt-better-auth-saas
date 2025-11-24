<script setup lang="ts">
import type { ChatActionSuggestion, ChatMessage } from '~/shared/utils/types'
import { computed } from 'vue'
import ChatMessagesList from './ChatMessagesList.vue'
import ChatPromptBar from './ChatPromptBar.vue'

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

const promptStatus = computed(() => {
  if (props.status === 'idle') {
    return 'ready'
  }
  return props.status
})

function handleSubmit(value: string) {
  emit('submit', value)
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
              v-for="action in actions"
              :key="`${action.type}-${action.sourceContentId}`"
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
          <ChatPromptBar
            :placeholder="placeholder"
            :disabled="disabled"
            :status="promptStatus"
            @submit="handleSubmit"
          />
        </template>
      </UChatPalette>
    </template>
  </USlideover>
</template>
