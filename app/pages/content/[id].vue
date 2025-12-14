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

watchEffect(() => {
  if (hasSlugParam.value || redirecting.value)
    return

  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === 't')
    return

  const target = contentId.value
    ? localePath(`/${slug}/content/${contentId.value}`)
    : localePath(`/${slug}/content`)

  redirecting.value = true
  router.replace(target)
})
</script>

<template>
  <ContentWorkspacePage />
</template>
