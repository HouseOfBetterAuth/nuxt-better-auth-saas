<script setup lang="ts">
definePageMeta({
  layout: 'workspace'
})

const route = useRoute()
const slug = computed(() => {
  const param = route.params.slug
  return Array.isArray(param) ? param[0] : param || ''
})
const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})
</script>

<template>
  <ChatDraftWorkspace
    :content-id="contentId"
    :organization-slug="slug"
  />
</template>
