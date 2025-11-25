<script setup lang="ts">
import { onMounted } from 'vue'

const { organization, session, fetchSession } = useAuth()
const router = useRouter()

definePageMeta({
  layout: false
})

onMounted(async () => {
  try {
    await fetchSession()

    const { data: orgs } = await organization.list()

    const activeId = session.value?.activeOrganizationId
    if (activeId) {
      const activeOrg = orgs?.find(o => o.id === activeId)
      if (activeOrg) {
        await router.push(`/${activeOrg.slug}/chat`)
        return
      }
    }

    if (orgs && orgs.length > 0) {
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      await router.push(`/${orgs[0].slug}/chat`)
    } else {
      await router.push('/onboarding')
    }
  } catch (error) {
    console.error('Failed to initialize chat landing page', error)
    await router.push('/onboarding')
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
