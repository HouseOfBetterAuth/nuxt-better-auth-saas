<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.(null) // Will be set by QuillioWidget based on conversation

useHead({
  title: 'Conversation'
})

// QuillioWidget will be rendered here and will handle loading the conversation
// based on the route param
</script>

<template>
  <div class="w-full">
    <ClientOnly>
      <QuillioWidget />
    </ClientOnly>
  </div>
</template>
