<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

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
const composerRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const handleSubmit = (value?: string | unknown) => {
  const input = typeof value === 'string' ? value : modelValue.value
  const trimmed = String(input || '').trim()
  if (trimmed) {
    emit('submit', trimmed)
  }
}

function setTextareaRef() {
  if (!composerRef.value) {
    textareaRef.value = null
    return
  }
  const node = composerRef.value.querySelector('textarea')
  if (node instanceof HTMLTextAreaElement) {
    textareaRef.value = node
  }
}

onMounted(() => {
  nextTick(setTextareaRef)
})

watch(composerRef, () => {
  nextTick(setTextareaRef)
})
</script>

<template>
  <div
    ref="composerRef"
    class="space-y-3 relative"
  >
    <div class="rounded-3xl overflow-hidden">
      <UChatPrompt
        v-model="modelValue"
        :placeholder="props.placeholder"
        variant="subtle"
        :disabled="props.disabled"
        class="flex-1 w-full min-h-[144px] [&>form]:flex [&>form]:flex-col [&>form]:min-h-[144px] [&_[data-slot=footer]]:mt-auto [&_[data-slot=footer]]:pt-2"
        :autofocus="props.autofocus"
        @submit="handleSubmit"
      >
        <template #footer>
          <div
            data-slot="footer"
            class="flex items-center justify-between gap-2 w-full"
          >
            <div>
              <slot name="footer" />
            </div>
            <div>
              <slot name="submit">
                <UChatPromptSubmit
                  :status="props.status || 'idle'"
                  submitted-color="primary"
                  submitted-variant="solid"
                  submitted-icon="i-custom-square-solid"
                  streaming-color="primary"
                  streaming-variant="solid"
                />
              </slot>
            </div>
          </div>
        </template>
      </UChatPrompt>
    </div>
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
