<script setup lang="ts">
import ChatQuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  layout: 'workspace'
})

const route = useRoute()
const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})
</script>

<template>
  <ChatQuillioWidget
    :initial-draft-id="contentId"
    :route-sync="false"
  />
</template>
