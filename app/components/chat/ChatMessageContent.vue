<script setup lang="ts">
import type { ChatMessage, MessagePart } from '#shared/utils/types'
import { computed } from 'vue'
import AgentProgressTracker from './progress/AgentProgressTracker.vue'
import WorkspaceFilesAccordion from './WorkspaceFilesAccordion.vue'

const props = withDefaults(defineProps<{
  message: ChatMessage
  displayText?: string | null
  bodyClass?: string
}>(), {
  displayText: null,
  bodyClass: ''
})

const { t } = useI18n()
const { currentActivity, activeToolActivities } = useConversation()

const liveToolActivities = computed(() => {
  const activities = activeToolActivities.value ?? []
  return activities
    .filter(activity => activity.messageId === props.message.id)
    .sort((a, b) => {
      const aTime = new Date(a.startedAt).getTime()
      const bTime = new Date(b.startedAt).getTime()
      return aTime - bTime
    })
})
const hasLiveToolActivities = computed(() => liveToolActivities.value.length > 0)

// Check if message has tool calls
const toolCalls = computed(() => props.message.parts.filter(p => p.type === 'tool_call'))
const hasToolCalls = computed(() => toolCalls.value.length > 0)
const textParts = computed(() => props.message.parts.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text' && !!p.text?.trim()))

const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'player.vimeo.com'
  // Add other trusted domains
]

const payload = computed(() => (props.message.payload as Record<string, any> | null) ?? null)
const preview = computed(() => payload.value?.preview ?? null)
const isError = computed(() => payload.value?.type === 'agent_failure' || payload.value?.type === 'error')
const errorDetails = computed(() => payload.value?.error || null)

const safeEmbedUrl = computed(() => {
  const embedUrl = preview.value?.embedUrl
  if (!embedUrl) {
    return null
  }

  try {
    const url = new URL(embedUrl)
    if (url.protocol !== 'https:') {
      return null
    }
    if (!ALLOWED_EMBED_DOMAINS.includes(url.hostname)) {
      return null
    }
    return embedUrl
  } catch {
    return null
  }
})

const workspaceSummaryBullets = computed(() => {
  if (payload.value?.type !== 'workspace_summary') {
    return []
  }
  return toSummaryBullets(payload.value.summary)
})

const baseClass = computed(() => ['prose prose-invert max-w-none text-[15px] leading-6', props.bodyClass].filter(Boolean).join(' '))

function toSummaryBullets(summary: string | null | undefined) {
  if (!summary) {
    return []
  }
  const normalized = summary.replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }
  const segments = normalized.split(/\n+/).map(segment => segment.trim()).filter(Boolean)
  if (segments.length > 1) {
    return segments
  }
  const sentences = normalized.split(/(?<=[.!?])\s+/).map(line => line.trim()).filter(Boolean)
  return sentences.length ? sentences : [normalized]
}
</script>

<template>
  <div
    v-if="payload?.type === 'workspace_summary'"
    :class="baseClass"
  >
    <p class="text-sm font-semibold">
      Summary
    </p>
    <ul class="list-disc pl-5 space-y-1">
      <li
        v-for="(item, index) in workspaceSummaryBullets"
        :key="index"
      >
        {{ item }}
      </li>
    </ul>
  </div>
  <div v-else-if="payload?.type === 'workspace_files' && Array.isArray(payload.files)">
    <WorkspaceFilesAccordion :files="payload.files" />
  </div>
  <div
    v-else
    :class="baseClass"
  >
    <div
      v-if="safeEmbedUrl"
      class="mb-4"
    >
      <iframe
        :src="safeEmbedUrl"
        class="w-full aspect-video rounded-xl"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="no-referrer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      />
    </div>
    <div
      v-else-if="preview?.thumbnailUrl && preview?.url"
      class="mb-4"
    >
      <NuxtLink
        :to="preview.url"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex flex-col gap-2 rounded-xl border border-surface-200/60 dark:border-surface-800/60 overflow-hidden"
      >
        <img
          :src="preview.thumbnailUrl"
          :alt="preview.title || 'Source preview'"
          class="w-full object-cover"
        >
        <div class="px-4 py-2 text-sm text-primary">
          {{ preview.title || 'View source' }}
        </div>
      </NuxtLink>
    </div>
    <div
      v-if="isError && errorDetails"
      class="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
    >
      <p class="font-medium mb-1">
        {{ t('chat.errorDetails') }}
      </p>
      <p class="font-mono text-xs whitespace-pre-wrap break-words opacity-90">
        {{ t('chat.genericError') }}
      </p>
    </div>

    <!-- Tool calls: Show first (they execute before the LLM response) -->
    <template v-if="hasToolCalls || hasLiveToolActivities">
      <AgentProgressTracker
        :message="message"
        :current-activity="currentActivity"
        :live-activities="liveToolActivities"
      />
    </template>

    <!-- Text parts: Show after tool calls (LLM response reflects tool results) -->
    <template v-if="textParts.length > 0 && !hasLiveToolActivities">
      <p
        v-for="(part, index) in textParts"
        :key="`${message.id}-text-${index}`"
        class="whitespace-pre-line"
      >
        {{ part.text }}
      </p>
    </template>
  </div>
</template>
