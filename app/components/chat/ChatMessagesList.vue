<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { useClipboard } from '@vueuse/core'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  selectedSectionId?: string | null
}>(), {
  selectedSectionId: null
})

const emit = defineEmits<{
  (e: 'regenerate', message: ChatMessage): void
  (e: 'referenceSection', sectionId: string): void
  (e: 'selectSection', sectionId: string): void
}>()

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const { copy } = useClipboard()
const toast = useToast()

function formatTimestamp(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }
  return formatter.format(date)
}

function handleCopy(message: ChatMessage) {
  copy(message.content)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied successfully.',
    color: 'primary'
  })
}

function handleRegenerate(message: ChatMessage) {
  emit('regenerate', message)
}

function badgeLabels(payload: Record<string, any> | null | undefined) {
  const labels: string[] = []
  if (!payload) {
    return labels
  }
  if (payload.sourceContentId) {
    labels.push('Source link')
  }
  if (payload.sectionId) {
    labels.push('Section patch')
  }
  if (payload.type && typeof payload.type === 'string' && payload.type !== 'sections_overview') {
    labels.push(payload.type.replace(/_/g, ' '))
  }
  return labels
}

function roleLabel(role: ChatMessage['role']) {
  return role === 'assistant' ? 'Quillio' : 'You'
}

function isSectionsOverview(message: ChatMessage): message is ChatMessage & { payload: { sections: any[] } } {
  return message.payload?.type === 'sections_overview' && Array.isArray(message.payload.sections)
}

function formatSectionPreview(body: string, limit = 280) {
  if (!body) {
    return ''
  }
  if (body.length <= limit) {
    return body
  }
  return `${body.slice(0, limit)}…`
}

function handleSectionReference(sectionId: string) {
  emit('referenceSection', sectionId)
}

function handleSectionSelect(sectionId: string) {
  emit('selectSection', sectionId)
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="message in props.messages"
      :key="message.id"
      class="rounded-2xl border border-muted-200/70 bg-background/90 p-4 shadow-sm"
      :class="message.role === 'assistant' ? 'border-primary/30' : ''"
    >
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-500">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold text-muted-800">
            {{ roleLabel(message.role) }}
          </span>
          <UBadge
            v-for="label in badgeLabels(message.payload)"
            :key="label"
            size="xs"
            color="primary"
            variant="soft"
            class="capitalize"
          >
            {{ label }}
          </UBadge>
        </div>
        <div class="flex items-center gap-2">
          <span>{{ formatTimestamp(message.createdAt) }}</span>
          <UDropdown
            :items="[[
              {
                label: 'Copy message',
                icon: 'i-lucide-copy',
                click: () => handleCopy(message)
              },
              message.role === 'user'
                ? {
                  label: 'Send again',
                  icon: 'i-lucide-rotate-ccw',
                  click: () => handleRegenerate(message)
                }
                : null
            ].filter(Boolean) as any]"
          >
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-more-horizontal"
            />
          </UDropdown>
        </div>
      </div>

      <div
        v-if="isSectionsOverview(message)"
        class="mt-3 space-y-3"
      >
        <p class="text-sm font-semibold text-muted-800">
          Sections overview
        </p>
        <UAccordion
          :items="message.payload.sections.map(section => ({ value: section.id, section }))"
          type="single"
          collapsible
          :ui="{ root: 'space-y-2' }"
        >
          <template #default="{ item }">
            <div
              class="flex items-center justify-between gap-3 py-2"
              :class="{ 'text-primary-600': props.selectedSectionId === item.section.id }"
            >
              <div class="min-w-0">
                <p class="font-medium truncate">
                  {{ item.section.title }}
                </p>
                <p class="text-xs text-muted-500">
                  H{{ item.section.level }} • {{ item.section.wordCount }} words
                </p>
              </div>
              <UBadge
                size="xs"
                :color="props.selectedSectionId === item.section.id ? 'primary' : 'neutral'"
                class="capitalize"
              >
                {{ props.selectedSectionId === item.section.id ? 'Active' : item.section.type }}
              </UBadge>
            </div>
          </template>
          <template #content="{ item }">
            <div class="space-y-2 text-sm text-muted-600">
              <p
                v-if="item.section.summary"
                class="text-muted-500"
              >
                {{ item.section.summary }}
              </p>
              <p class="whitespace-pre-line">
                {{ formatSectionPreview(item.section.body) }}
              </p>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <UBadge
                  size="xs"
                  color="primary"
                  variant="subtle"
                  class="cursor-pointer"
                  @click.stop="handleSectionReference(item.section.id)"
                >
                  @{{ item.section.anchor }}
                </UBadge>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-target"
                  @click.stop="handleSectionSelect(item.section.id)"
                >
                  Set active
                </UButton>
              </div>
            </div>
          </template>
        </UAccordion>
      </div>
      <div
        v-else
        class="mt-3 text-sm text-muted-800 whitespace-pre-line leading-relaxed"
      >
        {{ message.content }}
      </div>
    </div>
  </div>
</template>
