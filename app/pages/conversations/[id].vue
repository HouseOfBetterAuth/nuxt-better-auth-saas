<script setup lang="ts">
definePageMeta({
  auth: false, // Allow anonymous users
  ssr: false // Client-side only for instant navigation
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.(null)

useHead({
  title: 'Conversation'
})

// The default layout handles rendering the chat experience for /conversations routes.
</script>

<template>
  <div
    class="sr-only"
    aria-hidden="true"
  >
    Conversation
  </div>
</template>
