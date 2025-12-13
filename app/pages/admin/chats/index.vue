<script setup lang="ts">
definePageMeta({
  layout: false
})

interface Org {
  id: string
  name: string
  slug: string
  createdAt: string
}

const title = 'Chats'

const localePath = useLocalePath()

async function openOrg(orgId: string) {
  await navigateTo(localePath(`/admin/chats/${orgId}`))
}

const search = ref('')

const { data, pending, error, refresh } = await useFetch<{ orgs: Org[] }>(
  '/api/admin/chats/orgs',
  { method: 'GET' }
)

const orgs = computed(() => data.value?.orgs ?? [])

const filteredOrgs = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q)
    return orgs.value
  return orgs.value.filter((o) => {
    return o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
  })
})
</script>

<template>
  <NuxtLayout name="admin">
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-lg font-semibold">
            {{ title }}
          </h1>
          <p class="text-sm text-muted-foreground">
            Browse organizations and drill into conversations.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UInput
            v-model="search"
            placeholder="Search orgs…"
            class="w-64"
          />
          <UButton
            color="neutral"
            variant="outline"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Failed to load organizations"
        :description="String(error)"
      />

      <UCard>
        <div class="divide-y divide-neutral-200/70 dark:divide-neutral-800/60">
          <div
            v-for="org in filteredOrgs"
            :key="org.id"
            class="py-3 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <div class="font-medium truncate">
                {{ org.name }}
              </div>
              <div class="text-xs text-muted-foreground font-mono truncate">
                {{ org.slug }} · {{ org.id }}
              </div>
            </div>
            <UButton
              color="primary"
              variant="solid"
              @click="openOrg(org.id)"
            >
              View chats
            </UButton>
          </div>

          <div
            v-if="!pending && filteredOrgs.length === 0"
            class="py-6 text-sm text-muted-foreground text-center"
          >
            No organizations found.
          </div>
        </div>
      </UCard>
    </div>
  </NuxtLayout>
</template>
