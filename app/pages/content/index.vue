<script setup lang="ts">
const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Content')

useHead({
  title: 'Content'
})

// This page will show the content list in the sidebar
// The main content area will show a welcome message or empty state
</script>

<template>
  <div class="w-full py-8 sm:py-12">
    <div class="text-center space-y-4">
      <h1 class="text-2xl font-semibold">
        Select content to view
      </h1>
      <p class="text-muted-600 dark:text-muted-400">
        Choose content from the sidebar to view details
      </p>
    </div>
  </div>
</template>
