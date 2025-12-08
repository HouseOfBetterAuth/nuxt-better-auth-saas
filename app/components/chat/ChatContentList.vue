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
  isPending?: boolean
}

interface Props {
  draftsPending: boolean
  contentEntries: DraftEntry[]
  archivingDraftId?: string | null
  pendingMessage?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  openWorkspace: [entry: DraftEntry]
  archiveEntry: [entry: DraftEntry]
  stopEntry: [entry: DraftEntry]
}>()

const { formatDateListStamp } = useDate()
const pendingMessage = computed(() => props.pendingMessage?.trim() || 'Working on your draft...')

const activeTab = ref(0)

const swipeState = ref<{ id: string, startX: number, startY: number } | null>(null)
const SWIPE_THRESHOLD = 50
const SWIPE_VERTICAL_THRESHOLD = 30

const tabs = [
  { label: 'Content', value: 0 },
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

const STATUS_META: Record<string, { icon: string, label: string, badgeClass: string }> = {
  draft: {
    icon: 'i-lucide-pen-line',
    label: 'Draft',
    badgeClass: 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
  },
  in_review: {
    icon: 'i-lucide-eye',
    label: 'In review',
    badgeClass: 'bg-amber-400/20 text-amber-500 border border-amber-400/30'
  },
  ready_for_publish: {
    icon: 'i-lucide-rocket',
    label: 'Ready to publish',
    badgeClass: 'bg-sky-400/20 text-sky-500 border border-sky-400/30'
  },
  published: {
    icon: 'i-lucide-badge-check',
    label: 'Published',
    badgeClass: 'bg-purple-500/20 text-purple-500 border border-purple-500/30'
  },
  archived: {
    icon: 'i-lucide-archive',
    label: 'Archived',
    badgeClass: 'bg-rose-500/20 text-rose-500 border border-rose-500/30'
  }
}

const normalizeStatus = (status: string) => {
  return (status || '').toLowerCase().trim()
}

const getStatusMeta = (status: string) => {
  const normalized = normalizeStatus(status)
  return STATUS_META[normalized] || STATUS_META.draft
}

const formatContentId = (id: string) => {
  if (!id)
    return ''
  // Show first 8 characters for readability
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

const handleOpenWorkspace = (entry: DraftEntry) => {
  emit('openWorkspace', entry)
}

const handleArchiveEntry = (entry: DraftEntry) => {
  emit('archiveEntry', entry)
}

const handleStopEntry = (entry: DraftEntry) => {
  emit('stopEntry', entry)
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

  const isArchived = normalizeStatus(entry.status) === 'archived'
  const isProcessing = entry.isPending || props.archivingDraftId === entry.id

  if (
    deltaX < -SWIPE_THRESHOLD &&
    Math.abs(deltaY) < SWIPE_VERTICAL_THRESHOLD &&
    !isArchived &&
    !isProcessing
  ) {
    handleArchiveEntry(entry)
  }

  swipeState.value = null
}
</script>

<template>
  <section class="w-full">
    <UTabs
      v-model="activeTab"
      variant="link"
      :items="tabs"
      class="[&>div]:!mb-0 [&_*]:!mb-0"
    />

    <div
      v-if="hasFilteredContent"
      class="divide-y divide-white/5 dark:divide-white/10 mt-3"
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
          class="w-full text-left py-4 pr-12 sm:pr-12 pl-1 space-y-2 hover:bg-muted/30 transition-colors text-sm disabled:opacity-70 disabled:cursor-not-allowed"
          :disabled="entry.isPending"
          @click="handleOpenWorkspace(entry)"
        >
          <div class="flex items-start justify-between gap-2 sm:gap-3 min-w-0">
            <div class="flex-1 min-w-0 space-y-1">
              <p
                v-if="!entry.isPending"
                class="text-sm font-semibold leading-tight truncate"
              >
                {{ entry.title }}
              </p>
              <div
                v-else
                class="flex-1"
              >
                <div class="h-5 w-44 rounded bg-white/10 animate-pulse" />
              </div>
              <div
                v-if="!entry.isPending"
                class="text-sm text-muted-500 flex flex-wrap items-center gap-1 min-w-0"
              >
                <span class="truncate">{{ formatDateListStamp(entry.updatedAt) }}</span>
                <span class="shrink-0">·</span>
                <span class="capitalize truncate">
                  {{ entry.contentType || 'content' }}
                </span>
                <span class="shrink-0">·</span>
                <span
                  class="text-muted-500 truncate"
                  :title="entry.id"
                >
                  {{ formatContentId(entry.id) }}
                </span>
              </div>
              <div
                v-else
                class="flex items-center gap-2 text-primary-200 font-semibold capitalize"
              >
                <span class="animate-pulse truncate">{{ pendingMessage }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-square"
                  aria-label="Stop generation"
                  class="shrink-0"
                  @click.stop="handleStopEntry(entry)"
                />
              </div>
            </div>

            <div class="flex flex-col items-end gap-1 shrink-0">
              <div
                v-if="entry.isPending"
                class="h-6 w-28 rounded-full bg-white/10 animate-pulse"
              />
              <div
                v-else
                class="flex items-center gap-2 sm:gap-3"
              >
                <UBadge
                  variant="soft"
                  color="neutral"
                  class="rounded-full px-2 sm:px-2.5 py-1 gap-1 inline-flex items-center border text-[11px] shrink-0"
                  :class="getStatusMeta(entry.status).badgeClass"
                >
                  <UIcon
                    :name="getStatusMeta(entry.status).icon"
                    class="h-2.5 w-2.5 shrink-0"
                  />
                  <span class="leading-none truncate">
                    {{ getStatusMeta(entry.status).label }}
                  </span>
                </UBadge>
                <div class="text-sm font-semibold flex items-center gap-2 tabular-nums shrink-0">
                  <span class="text-emerald-500 dark:text-emerald-400">
                    +{{ entry.additions ?? 0 }}
                  </span>
                  <span class="text-rose-500 dark:text-rose-400">
                    -{{ entry.deletions ?? 0 }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </button>
        <div
          v-if="!entry.isPending && normalizeStatus(entry.status) !== 'archived'"
          class="absolute inset-y-0 right-0 flex items-center pr-2"
        >
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
      {{ activeTab === 1 ? 'No archived content yet' : 'No content yet' }}
    </div>
  </section>
</template>
