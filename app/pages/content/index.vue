<script setup lang="ts">
const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Content')

useHead({
  title: 'Content'
})

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const redirecting = ref(false)

const hasSlugParam = computed(() => {
  const param = route.params.slug
  if (Array.isArray(param))
    return Boolean(param[0])
  return typeof param === 'string' && param.trim().length > 0
})

watchEffect(() => {
  if (hasSlugParam.value || redirecting.value)
    return

  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === 't')
    return

  redirecting.value = true
  router.replace(localePath(`/${slug}/content`))
})
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
