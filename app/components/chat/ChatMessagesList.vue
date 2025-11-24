<script setup lang="ts">
import type { ChatMessage } from '~/shared/utils/types'
import { useAttrs } from 'vue'
import ChatMessageAssistant from './ChatMessageAssistant.vue'
import ChatMessageUser from './ChatMessageUser.vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error' | 'idle'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  messages: ChatMessage[]
  status?: ChatStatus
  compact?: boolean
}>(), {
  status: 'ready',
  compact: false
})

const attrs = useAttrs()
</script>

<template>
  <UChatMessages
    v-bind="attrs"
    :messages="messages"
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
