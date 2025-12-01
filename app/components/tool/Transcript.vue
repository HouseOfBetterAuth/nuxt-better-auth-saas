<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  loading?: boolean
  title?: string
}>(), {
  loading: false,
  title: 'Attach transcript'
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', value: { text: string }): void
}>()

const transcript = ref('')

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    transcript.value = ''
  }
})

function handleSubmit() {
  const text = transcript.value.trim()
  if (!text) {
    return
  }
  emit('submit', { text })
}
</script>

<template>
  <div
    v-if="props.open"
    class="w-full flex items-start gap-2"
  >
    <UTextarea
      v-model="transcript"
      placeholder="Paste the transcript here…"
      autofocus
      :rows="3"
      class="flex-1"
    />
    <UButton
      color="primary"
      :loading="props.loading"
      :disabled="!transcript.trim()"
      @click="handleSubmit"
    >
      Send
    </UButton>
  </div>
</template>
