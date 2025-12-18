<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const localePath = useLocalePath()
const { loggedIn, fetchSession, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const sessionReady = ref(false)
const hasNavigated = ref(false)

onMounted(async () => {
  try {
    await fetchSession()
  } catch {
    // Ignore - page can still render for anonymous users
  } finally {
    sessionReady.value = true
  }
})

// Watch for when session becomes ready and user logs in, then navigate once
watch([sessionReady, loggedIn], () => {
  if (sessionReady.value && loggedIn.value && !hasNavigated.value) {
    hasNavigated.value = true
    const slug = activeOrg.value?.data?.slug
    const target = slug && slug !== 't' ? `/${slug}/conversations` : '/t/conversations'
    navigateTo(localePath(target))
  }
})
</script>

<template>
  <div class="w-full h-full">
    <ClientOnly>
      <KeepAlive :max="5">
        <QuillioWidget />
      </KeepAlive>
    </ClientOnly>
  </div>
</template>
