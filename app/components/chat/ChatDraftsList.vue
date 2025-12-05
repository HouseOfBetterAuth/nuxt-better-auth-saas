<script setup lang="ts">
interface DraftEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  additions?: number
  deletions?: number
}

interface Props {
  draftsPending: boolean
  contentEntries: DraftEntry[]
  archivingDraftId?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  openWorkspace: [entry: DraftEntry]
  archiveEntry: [entry: DraftEntry]
}>()

const activeTab = ref(0)

const swipeState = ref<{ id: string, startX: number, startY: number } | null>(null)
const SWIPE_THRESHOLD = 50
const SWIPE_VERTICAL_THRESHOLD = 30

const tabs = [
  { label: 'Drafts', value: 0 },
  { label: 'Archived', value: 1 }
]

const filteredEntries = computed(() => {
  if (activeTab.value === 1) {
    // Show only archived items
    return props.contentEntries.filter((entry) => {
      const status = (entry.status || '').toLowerCase().trim()
      return status === 'archived'
    })
  }
  // Show non-archived items (Drafts tab)
  return props.contentEntries.filter((entry) => {
    const status = (entry.status || '').toLowerCase().trim()
    return status !== 'archived'
  })
})

const hasFilteredContent = computed(() => filteredEntries.value.length > 0)

const handleOpenWorkspace = (entry: DraftEntry) => {
  emit('openWorkspace', entry)
}

const handleArchiveEntry = (entry: DraftEntry) => {
  emit('archiveEntry', entry)
}

const onTouchStart = (entry: DraftEntry, event: TouchEvent) => {
  const touch = event.touches?.[0]
  if (!touch)
    return

  swipeState.value = {
    id: entry.id,
    startX: touch.clientX,
    startY: touch.clientY
  }
}

const onTouchEnd = (entry: DraftEntry, event: TouchEvent) => {
  if (!swipeState.value || swipeState.value.id !== entry.id)
    return

  const touch = event.changedTouches?.[0]
  if (!touch)
    return

  const deltaX = touch.clientX - swipeState.value.startX
  const deltaY = touch.clientY - swipeState.value.startY

  if (deltaX < -SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_THRESHOLD)
    handleArchiveEntry(entry)
}

const formatUpdatedAt = (date: Date | null) => {
  if (!date) {
    return '—'
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
</script>

<template>
  <section class="space-y-3 w-full">
    <UTabs
      v-model="activeTab"
      variant="link"
      :items="tabs"
    />

    <div
      v-if="hasFilteredContent"
      class="divide-y divide-muted-200/60"
    >
      <div
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="group relative w-full"
        @touchstart.passive="onTouchStart(entry, $event)"
        @touchend.passive="onTouchEnd(entry, $event)"
      >
        <button
          type="button"
          class="w-full text-left py-4 pr-12 pl-1 space-y-2 hover:bg-muted/30 transition-colors"
          @click="handleOpenWorkspace(entry)"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium leading-tight truncate">
              {{ entry.title }}
            </p>
            <UBadge
              color="neutral"
              variant="soft"
              class="capitalize"
            >
              {{ entry.status || 'draft' }}
            </UBadge>
          </div>
          <div class="text-xs text-muted-500 flex flex-wrap items-center gap-1">
            <span>{{ formatUpdatedAt(entry.updatedAt) }}</span>
            <span>·</span>
            <span class="capitalize">
              {{ entry.contentType || 'content' }}
            </span>
            <span>·</span>
            <span class="font-mono text-[11px] text-muted-600 truncate">
              {{ entry.id }}
            </span>
            <span>·</span>
            <span class="text-emerald-500 dark:text-emerald-400">
              +{{ entry.additions ?? 0 }}
            </span>
            <span class="text-rose-500 dark:text-rose-400">
              -{{ entry.deletions ?? 0 }}
            </span>
          </div>
        </button>
        <div class="absolute inset-y-0 right-0 flex items-center pr-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-archive"
            class="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hidden sm:flex"
            :disabled="archivingDraftId === entry.id"
            :loading="archivingDraftId === entry.id"
            aria-label="Archive draft"
            @click.stop="handleArchiveEntry(entry)"
          />
        </div>
      </div>
    </div>
    <div
      v-else
      class="text-center text-sm text-muted-500"
    >
      {{ activeTab === 1 ? 'No archived drafts' : 'No drafts yet' }}
    </div>
  </section>
</template>
