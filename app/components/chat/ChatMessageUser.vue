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
  name: 'You',
  color: 'primary'
}
</script>

<template>
  <UChatMessage
    :id="message.id"
    role="user"
    side="right"
    variant="soft"
    :parts="parts"
    :avatar="avatar"
    :metadata="{ createdAt: message.createdAt }"
  />
</template>
