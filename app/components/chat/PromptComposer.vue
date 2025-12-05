<script setup lang="ts">
const props = withDefaults(defineProps<{
  placeholder?: string
  disabled?: boolean
  status?: 'idle' | 'submitted' | 'streaming' | 'error' | string | null
  contextLabel?: string
  contextValue?: string | null
  hint?: string | null
  autofocus?: boolean
}>(), {
  placeholder: '',
  disabled: false,
  status: 'idle',
  contextLabel: undefined,
  contextValue: null,
  hint: null,
  autofocus: false
})

const emit = defineEmits<{
  submit: [value: string]
}>()

const modelValue = defineModel<string>({ default: '' })

const handleSubmit = (value: string) => {
  emit('submit', value)
}
</script>

<template>
  <div class="space-y-3">
    <UChatPrompt
      v-model="modelValue"
      :placeholder="props.placeholder"
      variant="subtle"
      :disabled="props.disabled"
      class="flex-1 w-full min-h-[120px] [&>form]:flex [&>form]:flex-col [&>form]:min-h-[120px] [&_[data-slot=footer]]:mt-auto [&_[data-slot=footer]]:pt-2"
      :autofocus="props.autofocus"
      @submit="handleSubmit"
    >
      <slot name="submit">
        <UChatPromptSubmit :status="props.status || 'idle'" />
      </slot>
      <template #footer>
        <slot name="footer" />
      </template>
    </UChatPrompt>
    <div
      v-if="props.contextLabel || props.hint || $slots.context"
      class="flex flex-wrap items-center justify-between text-xs text-muted-500 mt-1"
    >
      <div
        v-if="props.contextLabel"
        class="flex items-center gap-1"
      >
        <span class="uppercase tracking-wide">
          {{ props.contextLabel }}:
        </span>
        <span class="font-medium text-muted-700 dark:text-muted-200">
          {{ props.contextValue || 'None' }}
        </span>
      </div>
      <slot
        v-else
        name="context"
      />
      <p
        v-if="props.hint"
        class="ml-auto"
      >
        {{ props.hint }}
      </p>
    </div>
  </div>
</template>
