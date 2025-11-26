<script setup lang="ts">
import { computed, ref, watch } from 'vue'

definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const router = useRouter()
const slug = computed(() => route.params.slug as string)
const contentId = computed(() => route.params.id as string)

const prompt = ref('')
const loading = ref(false)

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  resetSession
} = useContentChatSession(contentId)

const { data: content, pending, error, refresh } = await useFetch(() => `/api/content/${contentId.value}`, {
  key: () => `content-${contentId.value}`,
  default: () => null
})

const contentRecord = computed(() => content.value?.content ?? null)
const currentVersion = computed(() => content.value?.currentVersion ?? null)
const sourceDetails = computed(() => content.value?.sourceContent ?? null)

const title = computed(() => contentRecord.value?.title || 'Untitled draft')
const contentStatus = computed(() => contentRecord.value?.status || 'draft')
const generatedContent = computed(() => currentVersion.value?.bodyMdx || currentVersion.value?.bodyHtml || null)
const hasGeneratedContent = computed(() => !!generatedContent.value)
const frontmatter = computed(() => currentVersion.value?.frontmatter || null)
const assets = computed(() => currentVersion.value?.assets || null)
const seoSnapshot = computed(() => currentVersion.value?.seoSnapshot || null)

const sections = computed(() => {
  const sectionsData = currentVersion.value?.sections
  if (!Array.isArray(sectionsData)) {
    return []
  }

  return sectionsData.map((section: Record<string, any>, idx: number) => {
    const body = typeof section.body_mdx === 'string'
      ? section.body_mdx
      : typeof section.body === 'string'
        ? section.body
        : ''

    return {
      ...section,
      id: section.id || section.section_id || `section-${idx}`,
      index: Number.isFinite(section.index) ? section.index : idx,
      title: section.title || `Section ${idx + 1}`,
      type: section.type || section.meta?.planType || 'body',
      level: section.level || 2,
      anchor: section.anchor || slugify(section.title || `section-${idx}`),
      wordCount: Number.isFinite(section.wordCount)
        ? section.wordCount
        : body.split(/\s+/).filter(Boolean).length,
      summary: section.summary || section.meta?.summary || null,
      body
    }
  }).sort((a, b) => a.index - b.index)
})

const totalWordCount = computed(() => sections.value.reduce((sum, section) => sum + (section.wordCount || 0), 0))
const contentUpdatedAtLabel = computed(() => {
  const value = contentRecord.value?.updatedAt
  return value ? formatDate(value) : '—'
})

const sourceLink = computed(() => {
  const metadata = sourceDetails.value?.metadata as Record<string, any> | null
  if (metadata && typeof metadata.originalUrl === 'string') {
    return metadata.originalUrl
  }
  if (sourceDetails.value?.sourceType === 'youtube' && sourceDetails.value?.externalId) {
    return `https://www.youtube.com/watch?v=${sourceDetails.value.externalId}`
  }
  return null
})

const seoPlan = computed(() => {
  const snapshot = seoSnapshot.value
  const plan = snapshot && typeof snapshot === 'object' ? snapshot.plan : null
  return plan && typeof plan === 'object' ? plan : null
})

const seoKeywords = computed(() => {
  const planKeywords = seoPlan.value?.keywords
  if (Array.isArray(planKeywords)) {
    return planKeywords.filter(keyword => typeof keyword === 'string' && keyword.trim().length > 0)
  }
  return []
})

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return '—'
  }

  const date = typeof value === 'string' ? new Date(value) : value
  const timeValue = date instanceof Date ? date.getTime() : Number.NaN

  if (!Number.isFinite(timeValue)) {
    return '—'
  }

  return dateFormatter.format(date)
}

function sectionPreview(body: string, limit = 320) {
  if (!body) {
    return ''
  }
  if (body.length <= limit) {
    return body
  }
  return `${body.slice(0, limit)}…`
}

const selectedSectionId = ref<string | null>(null)
const selectedSection = computed(() => sections.value.find(section => section.id === selectedSectionId.value) ?? null)

const sectionSelectOptions = computed(() => sections.value.map(section => ({
  label: section.title,
  value: section.id,
  description: `${section.wordCount} words`,
  icon: 'i-lucide-align-left'
})))

watch(sections, (list) => {
  if (!list.length) {
    selectedSectionId.value = null
    return
  }

  if (!selectedSectionId.value || !list.some(section => section.id === selectedSectionId.value)) {
    selectedSectionId.value = list[0].id
  }
}, { immediate: true })

function focusSection(sectionId: string) {
  selectedSectionId.value = sectionId
}

const promptStatus = computed(() => {
  if (loading.value || status.value === 'submitted' || status.value === 'streaming') {
    return loading.value ? 'submitted' : (status.value as 'submitted' | 'streaming')
  }
  if (status.value === 'error') {
    return 'error'
  }
  return 'ready'
})

async function handleSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }
  if (!selectedSectionId.value) {
    return
  }
  loading.value = true
  try {
    await sendMessage(trimmed, {
      sectionId: selectedSectionId.value,
      sectionTitle: selectedSection.value?.title ?? null
    })
    prompt.value = ''
    await refresh()
  } finally {
    loading.value = false
  }
}

watch(() => contentId.value, async () => {
  await refresh()
  resetSession()
})
</script>

<template>
  <div class="flex flex-col gap-6 py-8">
    <UContainer class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            size="sm"
            @click="router.push(`/${slug}/chat`)"
          >
            Back to chat
          </UButton>
          <p class="text-sm text-muted-500">
            Last updated {{ contentUpdatedAtLabel }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UBadge :color="contentStatus === 'published' ? 'primary' : 'neutral'">
            {{ contentStatus }}
          </UBadge>
          <UButton
            icon="i-lucide-refresh-ccw"
            variant="ghost"
            size="sm"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>

      <UCard class="space-y-3 text-center">
        <h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
          {{ title }}
        </h1>
        <p
          v-if="frontmatter?.description"
          class="text-muted-500 max-w-4xl mx-auto leading-relaxed"
        >
          {{ frontmatter.description }}
        </p>
        <div class="flex flex-wrap justify-center gap-3 text-xs text-muted-500">
          <span>Content type: <strong class="capitalize">{{ frontmatter?.contentType || 'n/a' }}</strong></span>
          <span>Primary keyword: <strong>{{ frontmatter?.primaryKeyword || '—' }}</strong></span>
          <span>Locale: <strong>{{ frontmatter?.targetLocale || '—' }}</strong></span>
        </div>
      </UCard>

      <div v-if="errorMessage">
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
        />
      </div>

      <div
        v-if="error && !content"
        class="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center"
      >
        Content not found or you don't have access to this draft.
      </div>

      <div
        v-else-if="pending"
        class="grid gap-6 lg:grid-cols-[2fr,1fr]"
      >
        <div class="space-y-4">
          <div class="h-48 rounded-2xl bg-muted animate-pulse" />
          <div class="h-32 rounded-2xl bg-muted animate-pulse" />
          <div class="h-32 rounded-2xl bg-muted animate-pulse" />
        </div>
        <div class="space-y-4">
          <div class="h-64 rounded-2xl bg-muted animate-pulse" />
          <div class="h-48 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>

      <div
        v-else-if="content"
        class="grid gap-6 lg:grid-cols-[2fr,1fr]"
      >
        <div class="space-y-6">
          <UCard class="space-y-4">
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <UBadge
                  v-if="frontmatter?.contentType"
                  variant="soft"
                >
                  {{ frontmatter.contentType }}
                </UBadge>
                <UBadge
                  v-if="sourceDetails?.sourceType"
                  color="neutral"
                  variant="soft"
                  class="capitalize"
                >
                  {{ sourceDetails.sourceType.replace('_', ' ') }}
                </UBadge>
                <span class="text-muted-500">
                  {{ sections.length }} sections • {{ totalWordCount }} words
                </span>
              </div>
              <div class="flex flex-wrap gap-6 text-sm text-muted-500">
                <div>
                  <p class="text-xs uppercase tracking-wide text-muted-400">
                    Created by
                  </p>
                  <p>{{ contentRecord?.createdByUserId || '—' }}</p>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-wide text-muted-400">
                    Version
                  </p>
                  <p>{{ currentVersion?.version ?? '1' }}</p>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-wide text-muted-400">
                    Primary keyword
                  </p>
                  <p>{{ frontmatter?.primaryKeyword || '—' }}</p>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-wide text-muted-400">
                    Locale
                  </p>
                  <p>{{ frontmatter?.targetLocale || '—' }}</p>
                </div>
              </div>
              <div
                v-if="sourceLink"
                class="flex items-center gap-2"
              >
                <UButton
                  color="neutral"
                  icon="i-lucide-link-2"
                  variant="ghost"
                  size="sm"
                  :to="sourceLink"
                  target="_blank"
                >
                  View source
                </UButton>
                <p class="text-xs text-muted-500">
                  {{ sourceDetails?.externalId }}
                </p>
              </div>
            </div>
          </UCard>

          <UCard v-if="sections.length > 0">
            <template #header>
              <div class="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p class="text-sm text-muted-500">
                    Section outline
                  </p>
                  <p class="text-xl font-semibold">
                    {{ sections.length }} structured blocks
                  </p>
                </div>
                <UBadge
                  variant="soft"
                  size="sm"
                >
                  {{ totalWordCount }} words
                </UBadge>
              </div>
            </template>
            <div class="space-y-3">
              <div
                v-for="section in sections"
                :key="section.id"
                class="rounded-2xl border border-muted-200/60 bg-muted/30 p-4 space-y-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="font-medium">
                      {{ section.title }}
                    </p>
                    <p class="text-xs uppercase tracking-wide text-muted-400">
                      H{{ section.level }} • {{ section.wordCount }} words
                    </p>
                  </div>
                  <UBadge
                    color="neutral"
                    size="xs"
                    class="capitalize"
                  >
                    {{ section.type }}
                  </UBadge>
                </div>
                <p
                  v-if="section.summary"
                  class="text-sm text-muted-500"
                >
                  {{ section.summary }}
                </p>
                <div class="text-sm text-muted-600 whitespace-pre-line">
                  {{ sectionPreview(section.body) }}
                </div>
                <UAccordion
                  size="xs"
                  variant="ghost"
                >
                  <UAccordionItem :value="section.id">
                    <template #label>
                      <span class="text-primary text-xs">
                        Show full section
                      </span>
                    </template>
                    <pre class="whitespace-pre-wrap rounded-md bg-background/80 p-3 text-xs overflow-x-auto">{{ section.body }}</pre>
                  </UAccordionItem>
                </UAccordion>
                <div class="flex justify-end">
                  <UButton
                    size="xs"
                    color="primary"
                    variant="ghost"
                    icon="i-lucide-edit-3"
                    @click="focusSection(section.id)"
                  >
                    Edit this section
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>

          <UCard v-if="hasGeneratedContent">
            <template #header>
              <div class="flex items-center justify-between">
                <p class="text-lg font-semibold">
                  Draft body (MDX)
                </p>
                <UBadge
                  v-if="currentVersion?.version"
                  size="sm"
                  variant="soft"
                >
                  v{{ currentVersion.version }}
                </UBadge>
              </div>
            </template>
            <pre class="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md overflow-x-auto">{{ generatedContent }}</pre>
          </UCard>

          <UCard v-if="assets">
            <template #header>
              <p class="text-lg font-semibold">
                Generation metadata
              </p>
            </template>
            <div class="space-y-2 text-sm">
              <p class="text-muted-500">
                Engine: {{ assets.generator?.engine || 'codex' }}
              </p>
              <p class="text-muted-500">
                Generated at: {{ assets.generator?.generatedAt ? formatDate(assets.generator.generatedAt) : '—' }}
              </p>
              <p
                v-if="assets.generator?.stages"
                class="text-muted-500"
              >
                Stages: {{ Array.isArray(assets.generator.stages) ? assets.generator.stages.join(', ') : assets.generator.stages }}
              </p>
            </div>
          </UCard>
        </div>

        <div class="space-y-6">
          <UCard v-if="sourceDetails">
            <template #header>
              <p class="text-lg font-semibold">
                Source material
              </p>
            </template>
            <div class="space-y-2 text-sm">
              <p>
                <span class="text-muted-500">Type:</span>
                <span class="capitalize"> {{ sourceDetails.sourceType.replace('_', ' ') }}</span>
              </p>
              <p>
                <span class="text-muted-500">Ingest status:</span>
                <span class="capitalize"> {{ sourceDetails.ingestStatus || 'unknown' }}</span>
              </p>
              <p>
                <span class="text-muted-500">External ID:</span>
                {{ sourceDetails.externalId || '—' }}
              </p>
            </div>
          </UCard>

          <UCard v-if="frontmatter">
            <template #header>
              <p class="text-lg font-semibold">
                Frontmatter
              </p>
            </template>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-muted-500">
                  Slug
                </dt>
                <dd class="font-medium">
                  {{ frontmatter.slug }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-500">
                  Status
                </dt>
                <dd class="font-medium capitalize">
                  {{ frontmatter.status }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-500">
                  Content type
                </dt>
                <dd class="font-medium capitalize">
                  {{ frontmatter.contentType }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-500">
                  Source content ID
                </dt>
                <dd class="font-medium">
                  {{ frontmatter.sourceContentId || '—' }}
                </dd>
              </div>
            </dl>
          </UCard>

          <UCard v-if="seoPlan || seoKeywords.length">
            <template #header>
              <p class="text-lg font-semibold">
                SEO plan
              </p>
            </template>
            <div class="space-y-3">
              <p
                v-if="seoPlan?.description"
                class="text-sm text-muted-500"
              >
                {{ seoPlan.description }}
              </p>
              <div
                v-if="seoKeywords.length"
                class="flex flex-wrap gap-2"
              >
                <UBadge
                  v-for="keyword in seoKeywords"
                  :key="keyword"
                  variant="soft"
                  size="xs"
                >
                  {{ keyword }}
                </UBadge>
              </div>
              <p
                v-if="seoPlan?.schemaType"
                class="text-xs uppercase tracking-wide text-muted-400"
              >
                Schema: {{ seoPlan.schemaType }}
              </p>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <p class="text-lg font-semibold">
                Draft conversation
              </p>
            </template>
            <div class="space-y-4">
              <div
                v-if="sectionSelectOptions.length"
                class="space-y-1"
              >
                <label class="text-xs uppercase tracking-wide text-muted-500">
                  Editing section
                </label>
                <USelectMenu
                  v-model="selectedSectionId"
                  :items="sectionSelectOptions"
                  value-key="value"
                  placeholder="Select a section…"
                />
                <p
                  v-if="selectedSection"
                  class="text-xs text-muted-500"
                >
                  {{ selectedSection.wordCount }} words · {{ selectedSection.type }}
                </p>
              </div>
              <div
                v-else
                class="text-xs text-muted-500"
              >
                Sections will appear here once a draft exists.
              </div>
              <div
                v-if="messages.length > 0"
                class="rounded-xl border border-muted-200/60 bg-muted/30 p-2"
              >
                <ChatMessagesList
                  :messages="messages"
                  :status="status"
                />
              </div>

              <UChatPrompt
                v-model="prompt"
                placeholder="Describe the change you want..."
                variant="subtle"
                class="[view-transition-name:chat-prompt]"
                :disabled="loading || status === 'submitted' || status === 'streaming' || !selectedSectionId"
                @submit="handleSubmit"
              >
                <UChatPromptSubmit :status="promptStatus" />
              </UChatPrompt>
            </div>
          </UCard>
        </div>
      </div>
    </UContainer>
  </div>
</template>
