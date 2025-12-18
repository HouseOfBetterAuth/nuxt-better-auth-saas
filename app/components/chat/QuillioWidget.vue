<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onErrorCaptured } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  conversationId?: string | null
  contentId?: string | null
  syncRoute?: boolean
  embedded?: boolean
  useRouteConversationId?: boolean
  showMessages?: boolean
}>(), {
  syncRoute: true,
  embedded: false,
  useRouteConversationId: true,
  showMessages: true
})

const emit = defineEmits<{
  (e: 'loading'): void
  (e: 'ready'): void
  (e: 'error'): void
}>()

const ChatShell = defineAsyncComponent({
  loader: () => import('./ChatShell.vue'),
  delay: 200,
  timeout: 10000,
  suspensible: true,
  onError(error, retry, fail, attempts) {
    console.error('[ChatShell] Failed to load', error)
    if (attempts <= 2) {
      retry()
    } else {
      fail(error)
    }
  }
})

const chatWidgetStatus = useState<'loading' | 'ready' | 'error'>('chat-widget-status', () => 'loading')
const setWidgetStatus = (status: 'loading' | 'ready' | 'error') => {
  chatWidgetStatus.value = status
  emit(status)
}
const handleShellReady = () => {
  setWidgetStatus('ready')
}
const handleShellLoading = () => {
  if (chatWidgetStatus.value !== 'error')
    setWidgetStatus('loading')
}
const handleResetError = (resetError: () => void) => {
  setWidgetStatus('loading')
  resetError()
}

onBeforeUnmount(() => {
  setWidgetStatus('loading')
})

onErrorCaptured(() => {
  setWidgetStatus('error')
})

const reloadPage = () => {
  if (typeof window !== 'undefined')
    window.location.reload()
}
</script>

<template>
  <div
    class="h-full min-h-0 w-full"
    v-bind="$attrs"
  >
    <ClientOnly>
      <NuxtErrorBoundary>
        <template #error="{ error, resetError }">
          <div class="flex flex-col items-center gap-3 rounded-md border border-neutral-200/70 dark:border-neutral-800/60 p-4 text-center">
            <p class="text-sm text-muted-foreground">
              Failed to load the chat experience. {{ error?.message || 'Please try again.' }}
            </p>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <UButton
                size="sm"
                color="primary"
                @click="handleResetError(resetError)"
              >
                Try again
              </UButton>
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                @click="reloadPage"
              >
                Reload page
              </UButton>
            </div>
          </div>
        </template>
        <Suspense
          @pending="handleShellLoading"
          @resolve="handleShellReady"
        >
          <template #fallback>
            <div class="text-sm text-muted-foreground">
              Loading chat...
            </div>
          </template>
          <ChatShell
            :conversation-id="props.conversationId"
            :content-id="props.contentId"
            :sync-route="props.syncRoute"
            :embedded="props.embedded"
            :use-route-conversation-id="props.useRouteConversationId"
            :show-messages="props.showMessages"
          />
        </Suspense>
      </NuxtErrorBoundary>
    </ClientOnly>
  </div>
</template>
