<script setup lang="ts">
const props = withDefaults(defineProps<{
  title?: string
  message?: string | null
  limit?: number | null
  used?: number | null
  remaining?: number | null
  planLabel?: string | null
  primaryLabel?: string
  cancelLabel?: string
}>(), {
  title: 'Quota limit reached',
  message: null,
  limit: null,
  used: null,
  remaining: null,
  planLabel: null,
  primaryLabel: 'Upgrade',
  cancelLabel: 'Maybe later'
})

const emit = defineEmits<{
  (e: 'primary'): void
  (e: 'cancel'): void
}>()

const open = defineModel<boolean>('open', {
  default: false,
  local: true
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="props.title"
  >
    <template #body>
      <div class="space-y-4">
        <slot
          name="message"
          :limit="props.limit"
          :plan-label="props.planLabel"
        >
          <p class="text-sm text-muted-600 dark:text-muted-400">
            {{ props.message || `You've reached the ${props.limit ?? 'current'} conversation limit. ${props.planLabel || 'Your current plan'} has a conversation quota. Upgrade to unlock more conversations or archive conversations to keep going.` }}
          </p>
        </slot>

        <slot name="actions">
          <div class="flex justify-end gap-2 pt-4">
            <UButton
              color="primary"
              @click="emit('primary')"
            >
              {{ props.primaryLabel }}
            </UButton>
            <UButton
              color="gray"
              variant="ghost"
              @click="emit('cancel')"
            >
              {{ props.cancelLabel }}
            </UButton>
          </div>
        </slot>
      </div>
    </template>
  </UModal>
</template>
