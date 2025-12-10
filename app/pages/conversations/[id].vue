<script setup lang="ts">
definePageMeta({
  auth: false // Allow anonymous users
})

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const conversationId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
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
