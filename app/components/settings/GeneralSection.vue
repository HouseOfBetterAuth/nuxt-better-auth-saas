<script setup lang="ts">
/**
 * General organization settings section
 * Allows updating organization name, slug, timezone
 *
 * Usage: <SettingsGeneralSection :can-edit="canUpdateSettings" />
 */
import { useClipboard } from '@vueuse/core'

const { canEdit } = defineProps<{
  canEdit?: boolean
}>()

const { organization, useActiveOrganization, fetchSession } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

// Use timezone composable
const { timezones, getTimezoneFromMetadata, getTimezoneValue } = useTimezone()

const loading = ref(false)
const teamName = ref('')
const teamSlug = ref('')
const copied = ref(false)
const teamTimezone = ref(timezones[0])

// Initialize and sync data from activeOrg
const lastSyncedOrgId = ref<string | null>(null)

watch(() => activeOrg.value?.data, (data) => {
  if (!data)
    return

  // Update basic fields only when switching organizations to preserve unsaved edits
  if (data.id !== lastSyncedOrgId.value) {
    teamName.value = data.name
    teamSlug.value = data.slug
    lastSyncedOrgId.value = data.id
  }

  // Sync timezone from metadata using composable
  teamTimezone.value = getTimezoneFromMetadata(data.metadata)
}, { immediate: true, deep: true })

async function updateTeam() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    const { error } = await organization.update({
      organizationId: activeOrg.value.data.id,
      data: {
        name: teamName.value,
        slug: teamSlug.value,
        metadata: {
          timezone: getTimezoneValue(teamTimezone.value)
        }
      }
    })

    if (error)
      throw error

    // Sync Stripe customer name (always sync to ensure it's up to date)
    await $fetch('/api/stripe/sync-customer-name', {
      method: 'POST',
      body: { organizationId: activeOrg.value.data.id, name: teamName.value }
    }).catch(e => console.warn('Failed to sync Stripe customer name:', e))

    toast.add({ title: 'Team updated successfully', color: 'success' })
    await fetchSession()

    // If slug changed, redirect to new URL
    if (teamSlug.value !== activeOrg.value.data.slug) {
      window.location.href = `/${teamSlug.value}/settings`
    }
  } catch (e: any) {
    toast.add({
      title: 'Error updating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

function copyId() {
  if (activeOrg.value?.data?.id) {
    copy(activeOrg.value.data.id)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
    toast.add({ title: 'Copied to clipboard' })
  }
}
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900">
    <h2 class="text-xl font-semibold mb-4">
      General information
    </h2>
    <p class="text-sm text-gray-500 mb-6">
      For billing purposes you can use the organization ID below.
    </p>

    <form
      class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6"
      @submit.prevent="updateTeam"
    >
      <UFormField label="Organization name (shows on invoices)">
        <UInput
          v-model="teamName"
          :disabled="!canEdit"
        />
      </UFormField>

      <UFormField label="Organization Timezone">
        <USelectMenu
          v-model="teamTimezone"
          :items="timezones"
          option-attribute="label"
          class="w-full"
          :disabled="!canEdit"
        />
      </UFormField>

      <UFormField label="Organization ID">
        <UInput
          :model-value="activeOrg?.data?.id"
          readonly
          class="font-mono text-sm bg-gray-50 dark:bg-gray-800"
        >
          <template #trailing>
            <UButton
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="gray"
              variant="ghost"
              size="xs"
              @click="copyId"
            />
          </template>
        </UInput>
      </UFormField>

      <div class="md:col-span-2">
        <UButton
          v-if="canEdit"
          type="submit"
          label="Save"
          color="black"
          :loading="loading"
        />
      </div>
    </form>
  </div>
</template>
