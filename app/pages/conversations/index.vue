<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const { t } = useI18n()
const localePath = useLocalePath()

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})

// This page will show the conversation list in the sidebar
// The main content area will show a welcome message or empty state
</script>

<template>
  <div class="w-full py-8 sm:py-12">
    <div class="text-center space-y-4">
      <h1 class="text-2xl font-semibold">
        Select a conversation to continue
      </h1>
      <p class="text-muted-600 dark:text-muted-400">
        Choose a conversation from the sidebar to view and continue your chat
      </p>
    </div>
  </div>
</template>
