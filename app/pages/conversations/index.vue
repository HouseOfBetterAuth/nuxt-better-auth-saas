<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false, // Allow anonymous users
  renderChatWidget: false
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})

const widgetStatus = ref<'loading' | 'ready' | 'error'>('loading')
const showFallback = computed(() => widgetStatus.value !== 'ready')
const fallbackMessage = computed(() => {
  if (widgetStatus.value === 'error')
    return 'Unable to load conversations. Please refresh the page.'
  return 'Loading conversations...'
})

const handleLoading = () => {
  widgetStatus.value = 'loading'
}

const handleReady = () => {
  widgetStatus.value = 'ready'
}

const handleError = () => {
  widgetStatus.value = 'error'
}
</script>

<template>
  <div class="w-full h-full">
    <div
      v-if="showFallback"
      class="flex items-center justify-center min-h-[40vh] px-4 text-center"
      aria-live="polite"
    >
      <p class="text-sm text-muted-foreground">
        {{ fallbackMessage }}
      </p>
    </div>
    <ClientOnly>
      <KeepAlive :max="5">
        <QuillioWidget
          @loading="handleLoading"
          @ready="handleReady"
          @error="handleError"
        />
      </KeepAlive>
    </ClientOnly>
  </div>
</template>
