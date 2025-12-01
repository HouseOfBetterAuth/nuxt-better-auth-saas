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

function handleClose() {
  emit('update:open', false)
}

function handleSubmit() {
  const text = transcript.value.trim()
  if (!text) {
    return
  }
  emit('submit', { text })
  transcript.value = ''
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
            {{ props.title }}
          </p>
          <p class="text-sm text-muted-500">
            Paste raw transcript text. We will automatically chunk and embed it for context.
          </p>
        </div>
      </template>

      <div class="space-y-3">
        <UFormGroup label="Transcript">
          <UTextarea
            v-model="transcript"
            placeholder="Paste the transcript here…"
            autofocus
            :rows="8"
          />
        </UFormGroup>
        <p class="text-xs text-muted-500">
          Tip: include speaker notes and timestamps — we&apos;ll preserve them for better retrieval later.
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
          :disabled="!transcript.trim()"
          @click="handleSubmit"
        >
          Attach transcript
        </UButton>
      </template>
    </UCard>
  </UModal>
</template>
