<script setup lang="ts">
const router = useRouter()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

// Special organization slug used for a non-org / tenant-less context.
// When the active org slug is missing or equals this value, we must fall back
// to non-organization conversation routes.
const NON_ORG_SLUG = 't'

const {
  items,
  pending,
  error,
  hasMore,
  initialized,
  loadInitial,
  loadMore
} = useConversationList({ pageSize: 40 })

onMounted(() => {
  if (!initialized.value) {
    loadInitial().catch(() => {})
  }
})

const openConversation = (conversationId: string | null) => {
  if (!conversationId)
    return
  const slug = activeOrg.value?.data?.slug
  if (slug && slug !== NON_ORG_SLUG) {
    router.push(localePath(`/${slug}/conversations/${conversationId}`))
  } else {
    // Fallback to non-organization route when org slug is unavailable.
    router.push(localePath(`/conversations/${conversationId}`))
  }
}

const startNewConversation = () => {
  const slug = activeOrg.value?.data?.slug
  if (slug && slug !== NON_ORG_SLUG) {
    router.push({
      path: localePath(`/${slug}/conversations`),
      query: { new: '1' }
    })
  } else {
    // Fallback to non-organization route.
    router.push({
      path: localePath('/conversations'),
      query: { new: '1' }
    })
  }
}
</script>

<template>
  <section class="w-full max-w-2xl mx-auto px-4 py-10 space-y-6">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-semibold">
          Conversations
        </h1>
        <p class="text-sm text-muted-foreground">
          Review your recent chats or start something new.
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        color="primary"
        @click="startNewConversation"
      >
        New conversation
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="Failed to load conversations"
      :description="error"
    />

    <div class="space-y-2">
      <template v-if="initialized && items.length">
        <button
          v-for="conversation in items"
          :key="conversation.id"
          type="button"
          class="w-full text-left rounded-lg border border-neutral-200/80 dark:border-neutral-800/70 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          @click="openConversation(conversation.id)"
        >
          <p class="text-base font-medium truncate">
            {{ conversation.displayLabel }}
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            {{ conversation.updatedAgo }}
          </p>
        </button>
      </template>

      <div
        v-else-if="pending && !initialized"
        class="space-y-2"
      >
        <div
          v-for="n in 4"
          :key="n"
          class="rounded-lg border border-neutral-200/80 dark:border-neutral-800/70 px-4 py-3"
        >
          <USkeleton class="h-4 w-2/3" />
          <USkeleton class="h-3 w-1/3 mt-2" />
        </div>
      </div>

      <p
        v-else
        class="text-sm text-muted-foreground text-center py-10"
      >
        No conversations yet. Start by asking a question or sharing a transcript.
      </p>
    </div>

    <div class="flex justify-center pt-2">
      <UButton
        v-if="hasMore"
        color="neutral"
        variant="outline"
        :loading="pending"
        @click="loadMore"
      >
        Load more
      </UButton>
    </div>
  </section>
</template>
