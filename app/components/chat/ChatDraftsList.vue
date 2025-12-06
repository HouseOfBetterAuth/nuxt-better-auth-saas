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

const { formatDateRelative } = useDate()
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

const STATUS_META: Record<string, { icon: string, color: InstanceType<typeof UBadge>['$props']['color'], label: string }> = {
  draft: { icon: 'i-lucide-pen-line', color: 'neutral', label: 'Draft' },
  in_review: { icon: 'i-lucide-eye', color: 'warning', label: 'In review' },
  ready_for_publish: { icon: 'i-lucide-rocket', color: 'primary', label: 'Ready to publish' },
  published: { icon: 'i-lucide-badge-check', color: 'primary', label: 'Published' },
  archived: { icon: 'i-lucide-archive', color: 'neutral', label: 'Archived' }
}

const getStatusMeta = (status: string) => {
  const normalized = (status || '').toLowerCase().trim()
  return STATUS_META[normalized] || STATUS_META.draft
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

  if (deltaX < -SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_THRESHOLD)
    handleArchiveEntry(entry)
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
      class="divide-y divide-muted-200/80 dark:divide-muted-800/70"
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
          class="w-full text-left py-4 pr-12 pl-1 space-y-2 hover:bg-muted/30 transition-colors text-sm disabled:opacity-70 disabled:cursor-not-allowed"
          :disabled="entry.isPending"
          @click="handleOpenWorkspace(entry)"
        >
          <div class="flex items-center justify-between gap-3">
            <p
              v-if="!entry.isPending"
              class="text-sm font-semibold leading-tight truncate text-white"
            >
              {{ entry.title }}
            </p>
            <div
              v-else
              class="flex-1"
            >
              <div class="h-5 w-44 rounded bg-white/10 animate-pulse" />
            </div>

            <UBadge
              v-if="!entry.isPending"
              :color="getStatusMeta(entry.status).color"
              variant="soft"
              class="rounded-full px-3 py-1.5 gap-1.5 flex items-center"
            >
              <UIcon
                :name="getStatusMeta(entry.status).icon"
                class="h-3.5 w-3.5"
              />
              <span class="leading-none">
                {{ getStatusMeta(entry.status).label }}
              </span>
            </UBadge>
            <div
              v-else
              class="flex items-center gap-2 text-primary-200 font-semibold capitalize"
            >
              <span class="animate-pulse">{{ pendingMessage }}</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-square"
                aria-label="Stop generation"
                @click.stop="handleStopEntry(entry)"
              />
            </div>
          </div>
          <div
            v-if="!entry.isPending"
            class="text-sm text-muted-400 flex flex-wrap items-center gap-1"
          >
            <span>{{ formatDateRelative(entry.updatedAt) }}</span>
            <span>·</span>
            <span class="capitalize">
              {{ entry.contentType || 'content' }}
            </span>
            <span>·</span>
            <span class="text-muted-500 truncate">
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
          <div
            v-else
            class="text-sm text-muted-400 flex flex-wrap items-center gap-2"
          >
            <div class="h-4 w-28 rounded bg-white/5 animate-pulse" />
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
      {{ activeTab === 1 ? 'No archived content yet' : 'No content yet' }}
    </div>
  </section>
</template>
