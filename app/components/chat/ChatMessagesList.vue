<script setup lang="ts">
import type { ChatMessage } from '~/shared/utils/types'
import { computed, useAttrs } from 'vue'
import ChatMessageAssistant from './ChatMessageAssistant.vue'
import ChatMessageUser from './ChatMessageUser.vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error' | 'idle'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  status?: ChatStatus
  compact?: boolean
}>(), {
  status: 'ready',
  compact: false
})

const attrs = useAttrs()

const formattedMessages = computed(() =>
  props.messages.map(message => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
    metadata: { createdAt: message.createdAt }
  }))
)
</script>

<template>
  <UChatMessages
    v-bind="attrs"
    :messages="formattedMessages"
    :status="status"
    :compact="compact"
    class="flex flex-col gap-4"
  >
    <template #default>
      <component
        :is="message.role === 'user' ? ChatMessageUser : ChatMessageAssistant"
        v-for="message in messages"
        :key="message.id"
        :message="message"
      />
    </template>
  </UChatMessages>
</template>
