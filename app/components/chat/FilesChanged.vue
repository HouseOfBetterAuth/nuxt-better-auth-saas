<script setup lang="ts">
interface ContentArtifact {
  id: string
  type: 'content_item'
  conversationId: string | null
  contentId: string
  data: {
    title: string
    slug: string
    status: string
    contentType: string
    currentVersion: {
      id: string
      version: number
      frontmatter: Record<string, any> | null
    } | null
  }
  createdAt: Date | string
}

interface Props {
  conversationId: string
}

const props = defineProps<Props>()

const { data: artifactsData, pending, error } = await useFetch<{ artifacts: ContentArtifact[] }>(
  `/api/conversations/${props.conversationId}/artifacts`,
  {
    default: () => ({ artifacts: [] })
  }
)

const artifacts = computed(() => artifactsData.value?.artifacts || [])

const hasFiles = computed(() => artifacts.value.length > 0)
</script>

<template>
  <div
    v-if="hasFiles || pending"
    class="space-y-2"
  >
    <div class="flex items-center gap-2 text-sm font-medium text-muted-600 dark:text-muted-400">
      <UIcon
        name="i-lucide-file-text"
        class="h-4 w-4"
      />
      <span>Files Changed</span>
      <span
        v-if="!pending"
        class="text-xs text-muted-500"
      >
        ({{ artifacts.length }})
      </span>
    </div>
    <div
      v-if="error"
      class="text-sm text-red-500 dark:text-red-400"
    >
      Failed to load files
    </div>
    <div
      v-if="pending"
      class="space-y-2"
    >
      <div
        v-for="i in 2"
        :key="i"
        class="h-12 rounded bg-white/5 animate-pulse"
      />
    </div>
    <div
      v-else-if="hasFiles"
      class="space-y-1.5"
    >
      <div
        v-for="artifact in artifacts"
        :key="artifact.id"
        class="flex items-center gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <UIcon
          name="i-lucide-file-code"
          class="h-4 w-4 text-muted-500 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">
            {{ artifact.data.title || 'Untitled' }}
          </p>
          <p class="text-xs text-muted-500 truncate">
            {{ artifact.data.slug }}.mdx
          </p>
        </div>
        <UBadge
          v-if="artifact.data.status"
          :color="artifact.data.status === 'published' ? 'success' : 'neutral'"
          variant="soft"
          size="xs"
        >
          {{ artifact.data.status }}
        </UBadge>
      </div>
    </div>
  </div>
</template>
