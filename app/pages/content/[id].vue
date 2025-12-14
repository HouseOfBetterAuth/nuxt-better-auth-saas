<script setup lang="ts">
import ContentWorkspacePage from '~/components/content/ContentWorkspacePage.vue'

definePageMeta({
  ssr: false
})

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

const hasSlugParam = computed(() => {
  const param = route.params.slug
  if (Array.isArray(param))
    return Boolean(param[0])
  return typeof param === 'string' && param.trim().length > 0
})

const redirecting = ref(false)
const hasRedirected = ref(false)

// Only redirect once per route change, and only if we don't have a slug
watchEffect(() => {
  // Skip if we already have a slug or are redirecting
  if (hasSlugParam.value || redirecting.value || hasRedirected.value)
    return

  // Skip if we don't have a content ID (shouldn't happen on this page, but safety check)
  if (!contentId.value)
    return

  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === 't')
    return

  // Only redirect if we're not already on the correct path
  const target = localePath(`/${slug}/content/${contentId.value}`)
  if (route.path === target)
    return

  redirecting.value = true
  hasRedirected.value = true
  router.replace(target).finally(() => {
    redirecting.value = false
  })
})

// Reset redirect flag when route changes
watch(() => route.path, () => {
  hasRedirected.value = false
})
</script>

<template>
  <ContentWorkspacePage :key="`content-${contentId}`" />
</template>
