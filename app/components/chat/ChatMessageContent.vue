<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import WorkspaceFilesAccordion from './WorkspaceFilesAccordion.vue'

const props = withDefaults(defineProps<{
  message: ChatMessage
  displayText?: string | null
  bodyClass?: string
}>(), {
  displayText: null,
  bodyClass: ''
})

const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'player.vimeo.com'
  // Add other trusted domains
]

const payload = computed(() => (props.message.payload as Record<string, any> | null) ?? null)
const resolvedText = computed(() => props.displayText ?? props.message.parts?.[0]?.text ?? '')
const preview = computed(() => payload.value?.preview ?? null)

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
    <p class="whitespace-pre-line">
      {{ resolvedText }}
    </p>
  </div>
</template>
