<script setup lang="ts">
const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()

const {
  items,
  pending,
  error,
  hasMore,
  initialized,
  loadInitial,
  loadMore
} = useConversationList({ pageSize: 40 })

const initialize = async () => {
  try {
    await loadInitial()
  } catch {
    // Errors are surfaced via UI alert; swallow here to avoid console noise
  }
}

onMounted(() => {
  initialize()
})

const activeConversationId = computed(() => {
  const id = route.params.id
  if (Array.isArray(id))
    return id[0] || null
  return id || null
})

const isConversationActive = (id: string) => {
  return activeConversationId.value === id
}

const openConversation = (conversationId: string | null) => {
  if (conversationId) {
    router.push(localePath(`/conversations/${conversationId}`))
  } else {
    router.push(localePath('/conversations'))
  }
}

const createConversation = () => {
  router.push({
    path: localePath('/conversations'),
    query: { new: '1' }
  })
}
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          Conversations
        </p>
        <UButton
          icon="i-lucide-plus"
          size="2xs"
          color="neutral"
          variant="ghost"
          aria-label="New conversation"
          @click="createConversation"
        />
      </div>

      <div class="space-y-1">
        <template v-if="initialized && items.length > 0">
          <button
            v-for="conversation in items"
            :key="conversation.id"
            type="button"
            class="w-full text-left rounded-md px-3 py-2 border border-transparent transition-colors"
            :class="isConversationActive(conversation.id)
              ? 'bg-neutral-100/80 dark:bg-neutral-800/60'
              : 'hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40'"
            @click="openConversation(conversation.id)"
          >
            <p class="text-sm font-medium truncate">
              {{ conversation.displayLabel }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ conversation.updatedAgo }}
            </p>
          </button>
        </template>

        <template v-else-if="pending && !initialized">
          <div
            v-for="n in 5"
            :key="n"
            class="rounded-md border border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2"
          >
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-3 w-1/2 mt-2" />
          </div>
        </template>

        <p
          v-else
          class="text-sm text-muted-foreground py-3"
        >
          No conversations yet.
        </p>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        :title="error"
      />

      <div class="pt-2">
        <UButton
          v-if="hasMore"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="pending"
          @click="loadMore()"
        >
          Load more
        </UButton>
      </div>
    </section>
  </div>
</template>
