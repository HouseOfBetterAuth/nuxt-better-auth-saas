<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({
  layout: false
})

const route = useRoute()
const orgId = computed(() => route.params.orgId as string)

const localePath = useLocalePath()

const detailOpen = ref(false)
const selectedConversationId = ref<string | null>(null)

interface ConversationDetail {
  org: { id: string, name: string, slug: string }
  conversation: {
    id: string
    organizationId: string
    status: string
    sourceContentId: string | null
    createdByUserId: string | null
    metadata: any
    createdAt: string
    updatedAt: string
  }
  messages: Array<{
    id: string
    role: string
    content: string
    payload: any
    createdAt: string
  }>
  logs: Array<{
    id: string
    type: string
    message: string
    payload: any
    createdAt: string
  }>
}

const detailUrl = computed(() => {
  if (!selectedConversationId.value)
    return null
  return `/api/admin/chats/org/${orgId.value}/conversations/${selectedConversationId.value}`
})

const {
  data: detailData,
  pending: detailPending,
  error: detailError,
  refresh: refreshDetail,
  clear: clearDetail
} = await useFetch<ConversationDetail>(
  () => detailUrl.value as any,
  {
    method: 'GET',
    immediate: false
  }
)

watch(detailOpen, async (open) => {
  if (open && selectedConversationId.value) {
    await refreshDetail()
  }
  if (!open) {
    selectedConversationId.value = null
    clearDetail()
  }
})

async function openConversation(conversationId: string) {
  selectedConversationId.value = conversationId
  detailOpen.value = true
}

interface Org { id: string, name: string, slug: string }

interface Conversation {
  id: string
  organizationId: string
  status: string
  sourceContentId: string | null
  createdByUserId: string | null
  metadata: any
  createdAt: string
  updatedAt: string
}

const { data, pending, error, refresh } = await useFetch<{ org: Org, conversations: Conversation[] }>(
  () => `/api/admin/chats/org/${orgId.value}/conversations`,
  { method: 'GET' }
)

const org = computed(() => data.value?.org)
const conversations = computed(() => data.value?.conversations ?? [])

const formatTime = (value: string) => {
  try {
    return format(new Date(value), 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return value
  }
}

const detailJson = computed(() => {
  if (!detailData.value)
    return ''
  try {
    return JSON.stringify(detailData.value, null, 2)
  } catch {
    return ''
  }
})
</script>

<template>
  <NuxtLayout name="admin">
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-xs text-muted-foreground">
            <NuxtLink
              :to="localePath('/admin/chats')"
              class="underline"
            >
              Chats
            </NuxtLink>
            <span v-if="org"> / {{ org.name }}</span>
          </div>
          <h1 class="text-lg font-semibold">
            {{ org?.name || 'Organization' }} Conversations
          </h1>
          <p class="text-sm text-muted-foreground font-mono">
            {{ org?.slug }} · {{ org?.id }}
          </p>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          :loading="pending"
          @click="refresh()"
        >
          Refresh
        </UButton>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Failed to load conversations"
        :description="String(error)"
      />

      <UCard>
        <div class="divide-y divide-neutral-200/70 dark:divide-neutral-800/60">
          <div
            v-for="c in conversations"
            :key="c.id"
            class="py-3 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <div class="font-mono text-xs truncate">
                {{ c.id }}
              </div>
              <div class="text-xs text-muted-foreground">
                Updated: {{ formatTime(c.updatedAt) }} · Status: {{ c.status }}
              </div>
            </div>
            <UButton
              color="primary"
              variant="solid"
              @click="openConversation(c.id)"
            >
              Open
            </UButton>
          </div>

          <div
            v-if="!pending && conversations.length === 0"
            class="py-6 text-sm text-muted-foreground text-center"
          >
            No conversations found for this org.
          </div>
        </div>
      </UCard>

      <UModal
        v-model:open="detailOpen"
        :title="detailData?.conversation?.id ? `Conversation ${detailData.conversation.id}` : 'Conversation'"
        :ui="{ content: 'sm:max-w-[96vw] lg:max-w-[1400px] xl:max-w-[1700px]' }"
      >
        <template #body>
          <div class="grid grid-cols-1 lg:grid-cols-[1.1fr,0.9fr] gap-4">
            <UCard>
              <template #header>
                <div class="flex items-center justify-between gap-2">
                  <div class="font-semibold">
                    Chat
                  </div>
                  <div class="flex items-center gap-2">
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="xs"
                      :loading="detailPending"
                      @click="refreshDetail()"
                    >
                      Refresh
                    </UButton>
                  </div>
                </div>
              </template>

              <UAlert
                v-if="detailError"
                color="error"
                variant="soft"
                title="Failed to load conversation"
                :description="String(detailError)"
                class="mb-3"
              />

              <div class="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                <div
                  v-for="m in detailData?.messages || []"
                  :key="m.id"
                  class="rounded-md border border-neutral-200/70 dark:border-neutral-800/60 p-3"
                >
                  <div class="sticky top-0 z-10 -mx-3 px-3 py-2 bg-white/90 dark:bg-neutral-900/90 backdrop-blur flex items-center justify-between gap-2">
                    <UBadge
                      color="neutral"
                      variant="soft"
                      size="xs"
                      class="capitalize"
                    >
                      {{ m.role }}
                    </UBadge>
                    <div class="text-[11px] text-muted-foreground">
                      {{ formatTime(m.createdAt) }}
                    </div>
                  </div>
                  <pre class="text-sm whitespace-pre-wrap break-words mt-2">{{ m.content }}</pre>
                </div>

                <div
                  v-if="!detailPending && (detailData?.messages?.length || 0) === 0"
                  class="text-sm text-muted-foreground text-center py-6"
                >
                  No messages.
                </div>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="font-semibold">
                  Raw JSON
                </div>
              </template>

              <div class="max-h-[70vh] overflow-y-auto">
                <pre class="text-xs whitespace-pre-wrap break-words">{{ detailJson }}</pre>
              </div>
            </UCard>
          </div>
        </template>
      </UModal>
    </div>
  </NuxtLayout>
</template>
