<script setup lang="ts">
import { ref } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

withDefaults(defineProps<{
  placeholder?: string
  disabled?: boolean
  status?: ChatStatus
}>(), {
  placeholder: 'Ask anything…',
  disabled: false,
  status: 'ready'
})

const emit = defineEmits<{
  submit: [value: string]
}>()

const prompt = ref('')

function handleSubmit() {
  const value = prompt.value.trim()
  if (!value) {
    return
  }
  emit('submit', value)
  prompt.value = ''
}
</script>

<template>
  <UChatPrompt
    v-model="prompt"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full"
    @submit="handleSubmit"
  >
    <template #footer>
      <div class="flex justify-end">
        <UChatPromptSubmit :status="status" />
      </div>
    </template>
  </UChatPrompt>
</template>
