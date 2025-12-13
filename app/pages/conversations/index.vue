<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})

const widgetStatus = useState<'loading' | 'ready' | 'error'>('chat-widget-status', () => 'loading')
const showFallback = computed(() => widgetStatus.value !== 'ready')
const fallbackMessage = computed(() => {
  if (widgetStatus.value === 'error')
    return 'Unable to load conversations. Please refresh the page.'
  return 'Loading conversations...'
})
</script>

<template>
  <div
    v-if="showFallback"
    class="flex items-center justify-center min-h-[40vh] px-4 text-center"
    aria-live="polite"
  >
    <p class="text-sm text-muted-foreground">
      {{ fallbackMessage }}
    </p>
  </div>
</template>
