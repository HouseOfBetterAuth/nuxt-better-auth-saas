<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({
  layout: false
})

const route = useRoute()
const orgId = computed(() => route.params.orgId as string)
const conversationId = computed(() => route.params.conversationId as string)

const localePath = useLocalePath()

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

interface Message {
  id: string
  role: string
  content: string
  payload: any
  createdAt: string
}

interface Log {
  id: string
  type: string
  message: string
  payload: any
  createdAt: string
}

const { data, pending, error, refresh } = await useFetch<{ org: Org, conversation: Conversation, messages: Message[], logs: Log[] }>(
  () => `/api/admin/chats/org/${orgId.value}/conversations/${conversationId.value}`,
  { method: 'GET' }
)

const org = computed(() => data.value?.org)
const conversation = computed(() => data.value?.conversation)
const messages = computed(() => data.value?.messages ?? [])
const logs = computed(() => data.value?.logs ?? [])

const formatTime = (value: string) => {
  try {
    return format(new Date(value), 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return value
  }
}
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
            <span v-if="org"> / </span>
            <NuxtLink
              v-if="org"
              :to="localePath(`/admin/chats/${orgId}`)"
              class="underline"
            >
              {{ org.name }}
            </NuxtLink>
          </div>
          <h1 class="text-lg font-semibold">
            Conversation
          </h1>
          <p class="text-xs text-muted-foreground font-mono">
            {{ conversation?.id }}
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
        title="Failed to load conversation"
        :description="String(error)"
      />

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="font-semibold">
                Messages
              </div>
              <div class="text-xs text-muted-foreground">
                {{ messages.length }}
              </div>
            </div>
          </template>

          <div class="space-y-3">
            <div
              v-for="m in messages"
              :key="m.id"
              class="rounded-md border border-neutral-200/70 dark:border-neutral-800/60 p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-mono text-muted-foreground truncate">
                  {{ m.id }}
                </div>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="xs"
                  class="capitalize"
                >
                  {{ m.role }}
                </UBadge>
              </div>
              <div class="text-xs text-muted-foreground mt-1">
                {{ formatTime(m.createdAt) }}
              </div>
              <pre class="text-sm whitespace-pre-wrap break-words mt-2">{{ m.content }}</pre>
            </div>

            <div
              v-if="!pending && messages.length === 0"
              class="text-sm text-muted-foreground text-center py-6"
            >
              No messages.
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="font-semibold">
                Logs
              </div>
              <div class="text-xs text-muted-foreground">
                {{ logs.length }}
              </div>
            </div>
          </template>

          <div class="space-y-3">
            <div
              v-for="l in logs"
              :key="l.id"
              class="rounded-md border border-neutral-200/70 dark:border-neutral-800/60 p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-mono text-muted-foreground truncate">
                  {{ l.id }}
                </div>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="xs"
                  class="capitalize"
                >
                  {{ l.type }}
                </UBadge>
              </div>
              <div class="text-xs text-muted-foreground mt-1">
                {{ formatTime(l.createdAt) }}
              </div>
              <pre class="text-sm whitespace-pre-wrap break-words mt-2">{{ l.message }}</pre>
            </div>

            <div
              v-if="!pending && logs.length === 0"
              class="text-sm text-muted-foreground text-center py-6"
            >
              No logs.
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </NuxtLayout>
</template>
