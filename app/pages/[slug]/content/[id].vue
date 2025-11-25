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
} = useContentChatSession(contentId.value)

const { data: content, pending, error, refresh } = await useFetch(() => `/api/content/${contentId.value}`, {
  key: () => `content-${contentId.value}`,
  default: () => null
})

const title = computed(() => content.value?.content.title || 'Untitled draft')
const contentStatus = computed(() => content.value?.content.status || 'draft')
const generatedContent = computed(() => content.value?.currentVersion?.bodyMdx || content.value?.currentVersion?.bodyHtml || null)
const hasGeneratedContent = computed(() => !!generatedContent.value)
const sections = computed(() => {
  const sectionsData = content.value?.currentVersion?.sections
  return Array.isArray(sectionsData) ? sectionsData : []
})
const frontmatter = computed(() => content.value?.currentVersion?.frontmatter || null)
const assets = computed(() => content.value?.currentVersion?.assets || null)
const seoSnapshot = computed(() => content.value?.currentVersion?.seoSnapshot || null)

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
  loading.value = true
  try {
    await sendMessage(trimmed)
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
  <div class="flex flex-col justify-center gap-4 sm:gap-6 py-8">
    <UContainer class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            size="sm"
            @click="router.push(`/${slug}/chat`)"
          >
            Back to chat
          </UButton>
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

      <div class="text-center">
        <h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
          {{ title }}
        </h1>
      </div>

      <div
        v-if="error && !content"
        class="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center"
      >
        Content not found or you don't have access to this draft.
      </div>

      <div v-if="errorMessage">
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
        />
      </div>

      <!-- Debug: Show raw data -->
      <div
        v-if="content"
        class="rounded-xl border border-dashed bg-muted/50 p-4 text-xs"
      >
        <details>
          <summary class="cursor-pointer font-medium mb-2">
            Debug: Raw API Data
          </summary>
          <pre class="whitespace-pre-wrap overflow-x-auto">{{ JSON.stringify(content, null, 2) }}</pre>
        </details>
      </div>

      <!-- Generated Content Display -->
      <div
        v-if="hasGeneratedContent"
        class="space-y-6"
      >
        <!-- MDX Content -->
        <div class="rounded-xl border bg-background p-6">
          <h2 class="text-lg font-semibold mb-4">
            Generated Content (MDX)
          </h2>
          <div class="prose prose-sm dark:prose-invert max-w-none">
            <pre class="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md overflow-x-auto">{{ content?.currentVersion?.bodyMdx }}</pre>
          </div>
        </div>

        <!-- Sections -->
        <div
          v-if="sections.length > 0"
          class="rounded-xl border bg-background p-6"
        >
          <h2 class="text-lg font-semibold mb-4">
            Sections ({{ sections.length }})
          </h2>
          <div class="space-y-3">
            <div
              v-for="(section, idx) in sections"
              :key="section.id || idx"
              class="border rounded-lg p-4 space-y-2"
            >
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="font-medium">
                    {{ section.title || `Section ${section.index ?? idx + 1}` }}
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    Type: {{ section.type || 'unknown' }}
                    <span v-if="section.level"> • Level: H{{ section.level }}</span>
                    <span v-if="section.wordCount"> • {{ section.wordCount }} words</span>
                  </p>
                </div>
                <UBadge
                  v-if="section.meta?.isKeySection"
                  color="primary"
                  size="xs"
                >
                  Key Section
                </UBadge>
              </div>
              <div
                v-if="section.startOffset !== undefined && section.endOffset !== undefined"
                class="text-xs text-muted-foreground"
              >
                Offset: {{ section.startOffset }} - {{ section.endOffset }}
                <span v-if="section.anchor"> • Anchor: {{ section.anchor }}</span>
              </div>
              <pre
                v-if="content?.currentVersion?.bodyMdx && section.startOffset !== undefined && section.endOffset !== undefined"
                class="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto"
              >
                {{ content.currentVersion.bodyMdx.slice(section.startOffset, section.endOffset) }}
              </pre>
            </div>
          </div>
        </div>

        <!-- Frontmatter -->
        <div
          v-if="frontmatter"
          class="rounded-xl border bg-background p-6"
        >
          <h2 class="text-lg font-semibold mb-4">
            Frontmatter
          </h2>
          <pre class="text-sm bg-muted p-4 rounded-md overflow-x-auto">{{ JSON.stringify(frontmatter, null, 2) }}</pre>
        </div>

        <!-- Assets -->
        <div
          v-if="assets"
          class="rounded-xl border bg-background p-6"
        >
          <h2 class="text-lg font-semibold mb-4">
            Assets
          </h2>
          <pre class="text-sm bg-muted p-4 rounded-md overflow-x-auto">{{ JSON.stringify(assets, null, 2) }}</pre>
        </div>

        <!-- SEO Snapshot -->
        <div
          v-if="seoSnapshot"
          class="rounded-xl border bg-background p-6"
        >
          <h2 class="text-lg font-semibold mb-4">
            SEO Snapshot
          </h2>
          <pre class="text-sm bg-muted p-4 rounded-md overflow-x-auto">{{ JSON.stringify(seoSnapshot, null, 2) }}</pre>
        </div>
      </div>

      <!-- Chat Interface for Editing -->
      <div class="space-y-4">
        <div
          v-if="messages.length > 0"
          class="rounded-xl border bg-background p-4"
        >
          <ChatMessagesList
            :messages="messages"
            :status="status"
          />
        </div>

        <UChatPrompt
          v-model="prompt"
          placeholder="Add instructions to update this draft…"
          variant="subtle"
          class="[view-transition-name:chat-prompt]"
          :disabled="loading || status === 'submitted' || status === 'streaming'"
          @submit="handleSubmit"
        >
          <UChatPromptSubmit :status="promptStatus" />
        </UChatPrompt>
      </div>
    </UContainer>
  </div>
</template>
