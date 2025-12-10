<script setup lang="ts">
definePageMeta({
  auth: false, // Allow anonymous users
  ssr: false // Client-side only for instant navigation
})

const route = useRoute()
const conversationId = computed(() => {
  const id = route.params.id
  return Array.isArray(id) ? id[0] : id
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
      <!-- KeepAlive prevents component remount on navigation (saves 250ms) -->
      <!-- QuillioWidget watches :conversation-id prop and handles changes reactively -->
      <KeepAlive>
        <QuillioWidget :conversation-id="conversationId" />
      </KeepAlive>
    </ClientOnly>
  </div>
</template>
