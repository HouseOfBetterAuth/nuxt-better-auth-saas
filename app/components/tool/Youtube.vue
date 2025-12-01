<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  loading?: boolean
}>(), {
  loading: false
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', value: { url: string }): void
}>()

const url = ref('')
const error = ref<string | null>(null)

const youtubeRegex = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)\w{11}[/?&=\w-]*$/i

function validate(value: string) {
  if (!youtubeRegex.test(value.trim())) {
    error.value = 'Enter a valid YouTube URL.'
    return false
  }
  error.value = null
  return true
}

function handleClose() {
  error.value = null
  url.value = ''
  emit('update:open', false)
}

function handleSubmit() {
  const value = url.value.trim()
  if (!validate(value)) {
    return
  }
  emit('submit', { url: value })
  url.value = ''
  handleClose()
}
</script>

<template>
  <div
    v-if="props.open"
    class="w-full flex items-center gap-2"
  >
    <UInput
      v-model="url"
      placeholder="https://www.youtube.com/watch?v=..."
      icon="i-lucide-youtube"
      :error="error || undefined"
      class="flex-1"
      @blur="url ? validate(url.trim()) : null"
    />
    <UButton
      color="primary"
      :loading="props.loading"
      :disabled="!url.trim()"
      @click="handleSubmit"
    >
      Send
    </UButton>
  </div>
</template>
