<script setup lang="ts">
import type { ChatMessage } from '~/shared/utils/types'
import { computed } from 'vue'

const props = defineProps<{ message: ChatMessage }>()

const parts = computed(() => [
  {
    type: 'text',
    text: props.message.content
  }
])

const avatar = {
  name: 'Codex',
  color: 'neutral',
  icon: 'i-lucide-bot'
}
</script>

<template>
  <UChatMessage
    :id="message.id"
    role="assistant"
    side="left"
    variant="naked"
    :parts="parts"
    :avatar="avatar"
    :metadata="{ createdAt: message.createdAt }"
  />
</template>
