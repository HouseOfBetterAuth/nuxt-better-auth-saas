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

const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[\w-]{11}/

function validate(value: string) {
  if (!youtubeRegex.test(value.trim())) {
    error.value = 'Enter a valid YouTube URL.'
    return false
  }
  error.value = null
  return true
}

function handleClose() {
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
  <UModal
    :open="props.open"
    :ui="{ container: 'items-end sm:items-center' }"
    @close="handleClose"
  >
    <UCard
      class="w-full sm:max-w-lg"
      :ui="{
        body: 'space-y-4',
        footer: 'flex items-center justify-between gap-3'
      }"
    >
      <template #header>
        <div>
          <p class="text-base font-semibold">
            Add YouTube source
          </p>
          <p class="text-sm text-muted-500">
            We will pull the transcript automatically and keep it linked in this chat.
          </p>
        </div>
      </template>

      <div class="space-y-2">
        <UFormGroup
          label="Video URL"
          :error="error || undefined"
        >
          <UInput
            v-model="url"
            placeholder="https://www.youtube.com/watch?v=..."
            icon="i-lucide-youtube"
            @blur="url ? validate(url) : null"
          />
        </UFormGroup>
        <p class="text-xs text-muted-500">
          Supports both youtube.com and youtu.be links.
        </p>
      </div>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="handleClose"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :loading="props.loading"
          :disabled="!url.trim()"
          @click="handleSubmit"
        >
          Save link
        </UButton>
      </template>
    </UCard>
  </UModal>
</template>
