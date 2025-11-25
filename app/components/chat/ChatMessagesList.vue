<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { computed } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error' | 'idle'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  status?: ChatStatus
  compact?: boolean
}>(), {
  status: 'ready',
  compact: false
})

// Transform ChatMessage[] to format UChatMessages expects
const uiMessages = computed(() => props.messages.map(message => ({
  id: message.id,
  role: message.role,
  parts: [
    {
      type: 'text' as const,
      text: message.content
    }
  ],
  ...(message.role === 'assistant' && message.createdAt ? {
    metadata: { createdAt: message.createdAt }
  } : {})
})))
</script>

<template>
  <UChatMessages
    :messages="uiMessages"
    :status="status"
    :compact="compact"
    :user="{
      side: 'right',
      variant: 'soft'
    }"
    class="flex flex-col gap-4"
  />
</template>
