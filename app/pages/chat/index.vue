<script setup lang="ts">
import { onMounted } from 'vue'

const { organization, session, fetchSession } = useAuth()
const router = useRouter()

definePageMeta({
  layout: false
})

onMounted(async () => {
  await fetchSession()

  const activeId = session.value?.activeOrganizationId
  if (activeId) {
    const { data: orgs } = await organization.list()
    const activeOrg = orgs?.find(o => o.id === activeId)
    if (activeOrg) {
      return router.push(`/${activeOrg.slug}/chat`)
    }
  }

  const { data: orgs } = await organization.list()

  if (orgs && orgs.length > 0) {
    await organization.setActive({ organizationId: orgs[0].id })
    await fetchSession()
    router.push(`/${orgs[0].slug}/chat`)
  } else {
    router.push('/onboarding')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <UIcon
      name="i-lucide-loader-2"
      class="w-8 h-8 animate-spin text-primary"
    />
  </div>
</template>
