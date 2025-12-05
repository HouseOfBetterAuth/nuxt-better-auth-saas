<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

interface MentionSection {
  id: string
  title: string
  anchor: string
  summary?: string | null
  preview?: string | null
}

const props = withDefaults(defineProps<{
  placeholder?: string
  disabled?: boolean
  status?: 'idle' | 'submitted' | 'streaming' | 'error' | string | null
  contextLabel?: string
  contextValue?: string | null
  hint?: string | null
  autofocus?: boolean
  sections?: MentionSection[]
}>(), {
  placeholder: '',
  disabled: false,
  status: 'idle',
  contextLabel: undefined,
  contextValue: null,
  hint: null,
  autofocus: false,
  sections: () => []
})

const emit = defineEmits<{
  submit: [value: string]
}>()

const modelValue = defineModel<string>({ default: '' })
const composerRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const caretPosition = ref(0)
const mentionActive = ref(false)
const mentionQuery = ref('')
const mentionTriggerIndex = ref<number | null>(null)
const mentionHighlightedIndex = ref(0)

const mentionSections = computed(() => props.sections || [])
const mentionResults = computed(() => {
  const query = mentionQuery.value.trim().toLowerCase()
  if (!query) {
    return mentionSections.value
  }
  return mentionSections.value.filter((section) => {
    const title = section.title?.toLowerCase() || ''
    const anchor = section.anchor?.toLowerCase() || ''
    const summary = section.summary?.toLowerCase() || ''
    return title.includes(query) || anchor.includes(query) || summary.includes(query)
  })
})
const mentionPanelVisible = computed(() => mentionActive.value)

const handleSubmit = (value: string) => {
  emit('submit', value)
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

const updateCaretPosition = () => {
  const el = textareaRef.value
  if (!el) {
    caretPosition.value = modelValue.value.length
    return
  }
  caretPosition.value = el.selectionStart ?? modelValue.value.length
}

function closeMention() {
  mentionActive.value = false
  mentionQuery.value = ''
  mentionTriggerIndex.value = null
  mentionHighlightedIndex.value = 0
}

function evaluateMentionState() {
  if (!mentionSections.value.length) {
    closeMention()
    return
  }
  const value = modelValue.value
  const caret = caretPosition.value
  const uptoCaret = value.slice(0, caret)
  const lastAt = uptoCaret.lastIndexOf('@')
  if (lastAt === -1) {
    closeMention()
    return
  }
  const charBefore = lastAt > 0 ? uptoCaret[lastAt - 1] : ''
  if (charBefore && /[^\s([{]/.test(charBefore)) {
    closeMention()
    return
  }
  const query = uptoCaret.slice(lastAt + 1)
  if (query.includes(' ') || query.includes('\n')) {
    closeMention()
    return
  }
  mentionActive.value = true
  mentionTriggerIndex.value = lastAt
  mentionQuery.value = query
}

function insertMention(section: MentionSection) {
  const triggerIndex = mentionTriggerIndex.value
  const value = modelValue.value
  const caret = caretPosition.value
  const mentionToken = `@${section.anchor}`
  const before = typeof triggerIndex === 'number' ? value.slice(0, triggerIndex) : value
  const after = typeof triggerIndex === 'number' ? value.slice(caret) : ''
  modelValue.value = `${before}${mentionToken} ${after.replace(/^\s*/, '')}`
  const nextCaret = before.length + mentionToken.length + 1
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus()
      textareaRef.value.setSelectionRange(nextCaret, nextCaret)
    }
    caretPosition.value = nextCaret
  })
  closeMention()
}

function handleMentionKeydown(event: KeyboardEvent) {
  if (!mentionPanelVisible.value || !mentionResults.value.length) {
    if (event.key === 'Escape' && mentionPanelVisible.value) {
      event.preventDefault()
      closeMention()
    }
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    mentionHighlightedIndex.value = (mentionHighlightedIndex.value + 1) % mentionResults.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    mentionHighlightedIndex.value =
      mentionHighlightedIndex.value === 0
        ? mentionResults.value.length - 1
        : mentionHighlightedIndex.value - 1
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    const section = mentionResults.value[mentionHighlightedIndex.value]
    if (section) {
      insertMention(section)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMention()
  }
}

function handleMentionClick(section: MentionSection) {
  insertMention(section)
}

onMounted(() => {
  nextTick(setTextareaRef)
})

watch(composerRef, () => {
  nextTick(setTextareaRef)
})

watch([modelValue, caretPosition], () => {
  evaluateMentionState()
})

watch(() => mentionResults.value.length, (length) => {
  if (!length) {
    mentionHighlightedIndex.value = 0
  } else if (mentionHighlightedIndex.value >= length) {
    mentionHighlightedIndex.value = 0
  }
})

useEventListener(textareaRef, 'input', updateCaretPosition)
useEventListener(textareaRef, 'click', updateCaretPosition)
useEventListener(textareaRef, 'keyup', updateCaretPosition)
useEventListener(textareaRef, 'focus', updateCaretPosition)
useEventListener(textareaRef, 'keydown', handleMentionKeydown)
useEventListener(textareaRef, 'blur', () => {
  closeMention()
})
</script>

<template>
  <div
    ref="composerRef"
    class="space-y-3 relative"
  >
    <div
      v-if="mentionPanelVisible"
      class="absolute bottom-full mb-2 left-0 w-full max-w-md rounded-lg border border-neutral-200/70 dark:border-neutral-800/60 bg-background shadow-lg z-20"
    >
      <div class="px-3 py-2 border-b border-neutral-200/70 dark:border-neutral-800/60">
        <p class="text-xs uppercase tracking-wide text-muted-500">
          Mention a section
        </p>
      </div>
      <div class="max-h-64 overflow-y-auto p-1">
        <button
          v-for="(section, index) in mentionResults"
          :key="section.id"
          type="button"
          class="w-full text-left px-3 py-2 rounded-md transition-colors"
          :class="mentionHighlightedIndex === index ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-100' : 'hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70'"
          @mousedown.prevent
          @click="handleMentionClick(section)"
        >
          <p class="text-sm font-medium truncate">
            {{ section.title }}
          </p>
          <p class="text-xs text-muted-500 whitespace-pre-line">
            @{{ section.anchor }} · {{ section.summary || section.preview || 'No preview yet' }}
          </p>
        </button>
        <div
          v-if="!mentionResults.length"
          class="px-3 py-4 text-sm text-muted-500"
        >
          No sections match “{{ mentionQuery }}”.
        </div>
      </div>
    </div>

    <UChatPrompt
      v-model="modelValue"
      :placeholder="props.placeholder"
      variant="subtle"
      :disabled="props.disabled"
      class="flex-1 w-full min-h-[120px] [&>form]:flex [&>form]:flex-col [&>form]:min-h-[120px] [&_[data-slot=footer]]:mt-auto [&_[data-slot=footer]]:pt-2"
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
              <UChatPromptSubmit :status="props.status || 'idle'" />
            </slot>
          </div>
        </div>
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
