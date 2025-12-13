<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})

// The default layout detects /conversations routes and mounts QuillioWidget.
// This page exists solely to provide metadata and header context.
</script>

<template>
  <div
    class="sr-only"
    aria-hidden="true"
  >
    Conversations
  </div>
</template>
