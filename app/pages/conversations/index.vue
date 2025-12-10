<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})

// This page will show the conversation list in the sidebar
// The main content area will show a welcome message or empty state
</script>

<template>
  <div class="w-full h-full">
    <ClientOnly>
      <QuillioWidget />
    </ClientOnly>
  </div>
</template>
