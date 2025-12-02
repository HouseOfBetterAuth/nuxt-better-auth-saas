<script setup lang="ts">
/**
 * API Keys management section
 * Allows users to create, view, and delete API keys for the organization
 *
 * Usage: <SettingsApiKeysSection :can-manage="canUpdateSettings" />
 */
import { useClipboard } from '@vueuse/core'

interface ApiKey {
  id: string
  name: string
  start: string
  prefix?: string
  createdAt: string
  lastRequest?: string
  expiresAt?: string
}

const { canManage } = defineProps<{
  canManage?: boolean
}>()

const { useActiveOrganization, client } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

const apiKeys = ref<ApiKey[]>([])
const loading = ref(false)
const isCreateModalOpen = ref(false)
const newKeyName = ref('')
const newKeyExpiresInDays = ref<number | undefined>(undefined)

// Expiration options in days
const expirationOptions = [
  { label: 'Never', value: undefined },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '365 days', value: 365 }
]
const createdKey = ref<string | null>(null)
const createLoading = ref(false)
const deleteConfirmId = ref<string | null>(null)
const isDeleteModalOpen = computed({
  get: () => deleteConfirmId.value !== null,
  set: (value) => {
    if (!value)
      deleteConfirmId.value = null
  }
})

const { formatDate } = useDate()

async function fetchApiKeys() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true
  try {
    const data = await $fetch<ApiKey[]>('/api/organization/api-keys', {
      query: { organizationId: activeOrg.value.data.id }
    })
    apiKeys.value = data || []
  } catch (e) {
    console.error(e)
    apiKeys.value = []
  } finally {
    loading.value = false
  }
}

async function createApiKey() {
  if (!activeOrg.value?.data?.id || !newKeyName.value)
    return
  createLoading.value = true
  try {
    const { data, error } = await client.apiKey.create({
      name: newKeyName.value,
      expiresIn: newKeyExpiresInDays.value ? newKeyExpiresInDays.value * 24 * 60 * 60 : undefined,
      metadata: {
        organizationId: activeOrg.value.data.id
      }
    })
    if (error)
      throw error

    if (data) {
      createdKey.value = data.key
      toast.add({ title: 'API Key created', color: 'success' })
      await fetchApiKeys()
    }
  } catch (e: any) {
    toast.add({ title: 'Error creating API Key', description: e.message, color: 'error' })
  } finally {
    createLoading.value = false
  }
}

function deleteApiKey(id: string) {
  deleteConfirmId.value = id
}

async function confirmDelete() {
  const id = deleteConfirmId.value
  if (!id)
    return

  deleteConfirmId.value = null

  try {
    await $fetch(`/api/organization/api-keys/${id}`, { method: 'DELETE' })
    toast.add({ title: 'API Key deleted', color: 'success' })
    await fetchApiKeys()
  } catch (e: any) {
    toast.add({ title: 'Error deleting API Key', description: e.message, color: 'error' })
  }
}

function copyKey(key: string) {
  copy(key)
  toast.add({ title: 'Copied to clipboard' })
}

function closeModal() {
  isCreateModalOpen.value = false
  createdKey.value = null
  newKeyName.value = ''
  newKeyExpiresInDays.value = undefined
}

onMounted(() => {
  fetchApiKeys()
})
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-semibold">
        API Keys
      </h2>
      <div
        v-if="canManage"
        class="flex items-center gap-2"
      >
        <span
          v-if="apiKeys.length >= 4"
          class="text-xs text-red-500"
        >
          Max 4 keys reached
        </span>
        <UButton
          label="Create New Key"
          icon="i-lucide-plus"
          size="sm"
          :disabled="apiKeys.length >= 4"
          @click="isCreateModalOpen = true"
        />
      </div>
    </div>
    <p class="text-sm text-gray-500 mb-6">
      Manage API keys for accessing the organization programmatically.
    </p>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="space-y-3"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
      >
        <div class="space-y-2">
          <USkeleton class="h-4 w-32" />
          <USkeleton class="h-3 w-48" />
          <USkeleton class="h-3 w-24" />
        </div>
        <USkeleton class="h-8 w-8 rounded-md" />
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!apiKeys || apiKeys.length === 0"
      class="text-sm text-gray-500"
    >
      No API keys found.
    </div>

    <!-- Keys List -->
    <div
      v-else
      class="space-y-4"
    >
      <div
        v-for="key in apiKeys"
        :key="key.id"
        class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
      >
        <div>
          <div class="font-medium">
            {{ key.name }}
          </div>
          <div class="text-xs text-gray-500 font-mono">
            {{ key.start }}... <span v-if="key.prefix">({{ key.prefix }})</span>
          </div>
          <div class="text-xs text-gray-400 mt-1">
            Created: {{ formatDate(key.createdAt) }}
            <span> • Last used: {{ key.lastRequest ? formatDate(key.lastRequest) : 'Never' }}</span>
            <span v-if="key.expiresAt"> • Expires: {{ formatDate(key.expiresAt) }}</span>
          </div>
        </div>
        <UButton
          v-if="canManage"
          color="red"
          variant="ghost"
          icon="i-lucide-trash-2"
          size="xs"
          @click="deleteApiKey(key.id)"
        />
      </div>
    </div>

    <!-- Create Modal -->
    <UModal
      v-model:open="isCreateModalOpen"
      title="Create API Key"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="createdKey"
            class="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800"
          >
            <p class="text-sm text-green-800 dark:text-green-200 font-medium mb-2">
              API Key Created! Copy it now, you won't see it again.
            </p>
            <div class="flex gap-2">
              <UInput
                :model-value="createdKey"
                readonly
                class="flex-1 font-mono"
              />
              <UButton
                icon="i-lucide-copy"
                color="gray"
                @click="copyKey(createdKey!)"
              />
            </div>
            <UButton
              class="mt-4"
              block
              @click="closeModal"
            >
              Done
            </UButton>
          </div>
          <div
            v-else
            class="space-y-4"
          >
            <UFormField label="Key Name">
              <UInput
                v-model="newKeyName"
                placeholder="e.g. CI/CD Pipeline"
                @keyup.enter="createApiKey"
              />
            </UFormField>
            <UFormField label="Expiration">
              <USelect
                v-model="newKeyExpiresInDays"
                :items="expirationOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <div class="flex justify-end gap-2 pt-4">
              <UButton
                label="Cancel"
                color="gray"
                variant="ghost"
                @click="closeModal"
              />
              <UButton
                label="Create"
                :loading="createLoading"
                :disabled="!newKeyName"
                @click="createApiKey"
              />
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="isDeleteModalOpen"
      title="Delete API Key"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Are you sure you want to delete this API Key? This action cannot be undone.
          </p>
          <div class="flex justify-end gap-2 pt-4">
            <UButton
              label="Cancel"
              color="gray"
              variant="ghost"
              @click="deleteConfirmId = null"
            />
            <UButton
              label="Delete"
              color="red"
              @click="confirmDelete"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
