<script setup lang="ts">
interface DraftEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  sectionsCount: number
  wordCount: number
  sourceType: string | null
  additions?: number
  deletions?: number
}

interface Props {
  draftsPending: boolean
  hasContent: boolean
  contentEntries: DraftEntry[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  openWorkspace: [entry: DraftEntry]
}>()

const activeTab = ref(0)

const tabs = [
  { label: 'Tasks' },
  { label: 'Archived' }
]

const filteredEntries = computed(() => {
  if (activeTab.value === 1) {
    return props.contentEntries.filter(entry => entry.status === 'archived')
  }
  return props.contentEntries.filter(entry => entry.status !== 'archived')
})

const hasFilteredContent = computed(() => filteredEntries.value.length > 0)

const handleOpenWorkspace = (entry: DraftEntry) => {
  emit('openWorkspace', entry)
}

const getStatusColor = (status: string): 'success' | 'primary' | 'warning' | 'error' | 'neutral' => {
  const statusColors: Record<string, 'success' | 'primary' | 'warning' | 'error' | 'neutral'> = {
    draft: 'neutral',
    published: 'success',
    archived: 'neutral',
    in_review: 'warning',
    ready_for_publish: 'primary'
  }
  return statusColors[status] || 'neutral'
}
</script>

<template>
  <section class="space-y-3 w-full">
    <UTabs
      v-model="activeTab"
      variant="link"
      :items="tabs"
    />

    <USkeleton
      v-if="draftsPending"
      class="space-y-2 flex flex-col gap-2 rounded-2xl border border-muted-200/60 p-4"
    >
      <div class="h-4 rounded bg-muted/70" />
      <div class="h-4 rounded bg-muted/60" />
      <div class="h-4 rounded bg-muted/50" />
    </USkeleton>
    <div
      v-else-if="hasFilteredContent"
      class="divide-y divide-muted-200/60"
    >
      <NuxtLink
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="block py-4 space-y-3 hover:bg-muted/30 transition-colors"
        @click.prevent="handleOpenWorkspace(entry)"
      >
        <div class="flex flex-wrap justify-between gap-4 items-start">
          <div class="flex-1 min-w-0">
            <p class="font-medium leading-tight">
              {{ entry.title }}
            </p>
            <p class="text-xs text-muted-500">
              Updated {{ entry.updatedAt ? entry.updatedAt.toLocaleDateString() : '—' }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <UBadge
              :color="getStatusColor(entry.status)"
              size="sm"
              variant="subtle"
            >
              {{ entry.status }}
            </UBadge>
            <div class="flex items-center gap-2 text-xs">
              <span
                v-if="entry.additions"
                class="text-emerald-500 dark:text-emerald-400 font-semibold"
              >
                +{{ entry.additions }}
              </span>
              <span
                v-if="entry.deletions"
                class="text-rose-500 dark:text-rose-400 font-semibold"
              >
                -{{ entry.deletions }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-4 text-xs text-muted-500">
          <span>{{ entry.sectionsCount }} sections</span>
          <span v-if="entry.wordCount">
            {{ entry.wordCount }} words
          </span>
          <span
            v-if="entry.sourceType"
            class="capitalize"
          >
            From: {{ entry.sourceType.replace('_', ' ') }}
          </span>
        </div>
      </NuxtLink>
    </div>
    <div
      v-else
      class="rounded-2xl border border-dashed border-muted-200/70 p-5 text-center text-sm text-muted-500"
    >
      No drafts yet
    </div>
  </section>
</template>
