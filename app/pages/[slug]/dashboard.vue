<script setup lang="ts">
const { user } = useAuth()
const router = useRouter()

definePageMeta({
  layout: 'default'
})

onMounted(() => {
  if (import.meta.client) {
    const pendingInvite = localStorage.getItem('pending_invite')
    if (pendingInvite) {
      localStorage.removeItem('pending_invite')
      router.push(`/accept-invite/${pendingInvite}`)
    }
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Welcome back, {{ user?.name }}!
        </h3>
      </template>
      <p class="text-neutral-500">
        This is your personal dashboard.
      </p>
    </UCard>
  </div>
</template>
