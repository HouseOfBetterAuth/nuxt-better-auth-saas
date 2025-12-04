<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
})

const { user, client, fetchSession } = useAuth()
const toast = useToast()
const route = useRoute()

// Form states
const name = ref(user.value?.name || '')
const newEmail = ref('')
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

// Loading states
const updatingName = ref(false)
const updatingEmail = ref(false)
const updatingPassword = ref(false)
const loadingAccounts = ref(false)
const linkingAccount = ref<string | null>(null)
const unlinkingAccount = ref<string | null>(null)
const deletingAccount = ref(false)
const showDeleteConfirm = ref(false)
const uploadingAvatar = ref(false)

// File input ref
const avatarInput = ref<HTMLInputElement | null>(null)

// Avatar initials fallback
const avatarInitials = computed(() => {
  if (!user.value?.name)
    return '?'
  return user.value.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
})

// Connected accounts
const accounts = ref<Array<{ providerId: string, accountId: string, createdAt: Date }>>([])

// Check if user has a password (credential account)
const hasPassword = computed(() => {
  return accounts.value.some(a => a.providerId === 'credential')
})

// Available social providers
const socialProviders = [
  { id: 'google', name: 'Google', icon: 'i-simple-icons-google' },
  { id: 'github', name: 'GitHub', icon: 'i-simple-icons-github' }
]

// Fetch connected accounts
async function fetchAccounts() {
  loadingAccounts.value = true
  try {
    const result = await client.listAccounts()
    if (result.data) {
      accounts.value = result.data
    }
  } catch (e: any) {
    console.error('Failed to fetch accounts:', e)
  } finally {
    loadingAccounts.value = false
  }
}

// Upload avatar
async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  // Validate file type
  if (!file.type.startsWith('image/')) {
    toast.add({ title: 'Please select an image file', color: 'error' })
    return
  }

  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    toast.add({ title: 'Image must be less than 5MB', color: 'error' })
    return
  }

  uploadingAvatar.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const response = await $fetch<{ file: { url: string } }>('/api/file/upload', {
      method: 'POST',
      body: formData
    })

    // Update user image
    await client.updateUser({ image: response.file.url })
    toast.add({ title: 'Profile picture updated', color: 'success' })
    // Reload to update all avatar instances
    window.location.reload()
  } catch (e: any) {
    toast.add({ title: 'Failed to upload image', description: e.message, color: 'error' })
  } finally {
    uploadingAvatar.value = false
    // Reset input
    if (avatarInput.value)
      avatarInput.value.value = ''
  }
}

// Remove avatar
async function removeAvatar() {
  uploadingAvatar.value = true
  try {
    await client.updateUser({ image: '' })
    toast.add({ title: 'Profile picture removed', color: 'success' })
    // Reload to update all avatar instances
    window.location.reload()
  } catch (e: any) {
    toast.add({ title: 'Failed to remove image', description: e.message, color: 'error' })
    uploadingAvatar.value = false
  }
}

// Update name
async function updateName() {
  if (!name.value.trim())
    return

  updatingName.value = true
  try {
    await client.updateUser({ name: name.value })
    await fetchSession()
    toast.add({ title: 'Name updated successfully', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to update name', description: e.message, color: 'error' })
  } finally {
    updatingName.value = false
  }
}

// Change email
async function changeEmail() {
  if (!newEmail.value.trim())
    return

  updatingEmail.value = true
  try {
    await client.changeEmail({
      newEmail: newEmail.value,
      callbackURL: `/${route.params.slug}/profile`
    })
    toast.add({
      title: 'Verification email sent',
      description: 'Please check your new email address to verify the change.',
      color: 'success'
    })
    newEmail.value = ''
  } catch (e: any) {
    toast.add({ title: 'Failed to change email', description: e.message, color: 'error' })
  } finally {
    updatingEmail.value = false
  }
}

// Change password
async function changePassword() {
  if (newPassword.value !== confirmPassword.value) {
    toast.add({ title: 'Passwords do not match', color: 'error' })
    return
  }

  updatingPassword.value = true
  try {
    await client.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      revokeOtherSessions: true
    })
    toast.add({ title: 'Password changed successfully', color: 'success' })
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e: any) {
    toast.add({ title: 'Failed to change password', description: e.message, color: 'error' })
  } finally {
    updatingPassword.value = false
  }
}

// Link social account
async function linkAccount(providerId: string) {
  linkingAccount.value = providerId
  try {
    await client.linkSocial({
      provider: providerId as 'google' | 'github',
      callbackURL: `/${route.params.slug}/profile?linked=${providerId}`
    })
  } catch (e: any) {
    toast.add({ title: 'Failed to link account', description: e.message, color: 'error' })
    linkingAccount.value = null
  }
}

// Unlink social account
async function unlinkAccount(providerId: string) {
  // Prevent unlinking if it's the only account
  if (accounts.value.length <= 1) {
    toast.add({
      title: 'Cannot unlink',
      description: 'You must have at least one sign-in method.',
      color: 'error'
    })
    return
  }

  unlinkingAccount.value = providerId
  try {
    await client.unlinkAccount({ providerId })
    await fetchAccounts()
    toast.add({ title: `${providerId} account unlinked`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to unlink account', description: e.message, color: 'error' })
  } finally {
    unlinkingAccount.value = null
  }
}

// Delete account
async function deleteAccount() {
  deletingAccount.value = true
  try {
    await client.deleteUser({
      callbackURL: '/'
    })
    toast.add({
      title: 'Verification email sent',
      description: 'Please check your email to confirm account deletion.',
      color: 'success'
    })
    showDeleteConfirm.value = false
  } catch (e: any) {
    toast.add({ title: 'Failed to delete account', description: e.message, color: 'error' })
  } finally {
    deletingAccount.value = false
  }
}

// Check for success messages from redirects
onMounted(() => {
  fetchAccounts()

  if (route.query.emailChanged) {
    toast.add({ title: 'Email changed successfully', color: 'success' })
  }
  if (route.query.linked) {
    toast.add({ title: `${route.query.linked} account linked successfully`, color: 'success' })
    fetchAccounts()
  }
})

// Sync name when user changes
watch(() => user.value?.name, (newName) => {
  if (newName)
    name.value = newName
}, { immediate: true })
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-8 p-4">
    <div>
      <h1 class="text-2xl font-bold">
        Profile Settings
      </h1>
      <p class="text-muted-foreground">
        Manage your account settings and connected accounts.
      </p>
    </div>

    <!-- Profile Information -->
    <div class="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
      <h2 class="text-lg font-semibold mb-4">
        Profile Information
      </h2>

      <div class="space-y-6">
        <!-- Avatar -->
        <div class="flex items-start gap-6">
          <div class="relative group">
            <UAvatar
              :src="user?.image || undefined"
              :alt="user?.name || 'User'"
              size="3xl"
              class="border-2 border-neutral-200 dark:border-neutral-700"
              :ui="{ fallback: 'text-2xl font-semibold' }"
            >
              <template
                v-if="!user?.image"
                #fallback
              >
                {{ avatarInitials }}
              </template>
            </UAvatar>
            <!-- Upload overlay -->
            <div
              class="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              @click="avatarInput?.click()"
            >
              <UIcon
                v-if="!uploadingAvatar"
                name="i-lucide-camera"
                class="w-8 h-8 text-white"
              />
              <UIcon
                v-else
                name="i-lucide-loader-2"
                class="w-8 h-8 text-white animate-spin"
              />
            </div>
          </div>
          <div class="flex-1">
            <p class="font-semibold text-lg">
              {{ user?.name }}
            </p>
            <p class="text-sm text-muted-foreground mb-3">
              {{ user?.email }}
            </p>
            <div class="flex gap-2">
              <UButton
                variant="outline"
                size="sm"
                icon="i-lucide-upload"
                :loading="uploadingAvatar"
                @click="avatarInput?.click()"
              >
                Upload Photo
              </UButton>
              <UButton
                v-if="user?.image"
                variant="ghost"
                size="sm"
                color="red"
                icon="i-lucide-trash-2"
                :loading="uploadingAvatar"
                @click="removeAvatar"
              >
                Remove
              </UButton>
            </div>
            <p class="text-xs text-muted-foreground mt-2">
              JPG, PNG or GIF. Max 5MB.
            </p>
            <!-- Hidden file input -->
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="uploadAvatar"
            >
          </div>
        </div>

        <!-- Name -->
        <UFormField label="Display Name">
          <div class="flex gap-2">
            <UInput
              v-model="name"
              placeholder="Your name"
              class="flex-1"
              @keyup.enter="updateName"
            />
            <UButton
              :loading="updatingName"
              :disabled="name === user?.name || !name.trim()"
              @click="updateName"
            >
              Save
            </UButton>
          </div>
        </UFormField>
      </div>
    </div>

    <!-- Email -->
    <div class="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
      <h2 class="text-lg font-semibold mb-4">
        Email Address
      </h2>

      <div class="space-y-4">
        <div class="flex items-center gap-2 p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg">
          <UIcon
            name="i-lucide-mail"
            class="w-5 h-5 text-muted-foreground"
          />
          <span>{{ user?.email }}</span>
          <UBadge
            v-if="user?.emailVerified"
            color="success"
            variant="subtle"
            size="xs"
          >
            Verified
          </UBadge>
        </div>

        <UFormField label="Change Email">
          <div class="flex gap-2">
            <UInput
              v-model="newEmail"
              type="email"
              placeholder="new@email.com"
              class="flex-1"
              @keyup.enter="changeEmail"
            />
            <UButton
              :loading="updatingEmail"
              :disabled="!newEmail.trim()"
              @click="changeEmail"
            >
              Change
            </UButton>
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            A verification email will be sent to your new address.
          </p>
        </UFormField>
      </div>
    </div>

    <!-- Password -->
    <div class="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="p-2 bg-neutral-100 dark:bg-neutral-700 rounded-lg">
          <UIcon
            name="i-lucide-lock"
            class="w-5 h-5 text-neutral-600 dark:text-neutral-300"
          />
        </div>
        <div>
          <h2 class="text-lg font-semibold">
            Password
          </h2>
          <p class="text-sm text-muted-foreground">
            {{ hasPassword ? 'Update your password to keep your account secure' : 'Add a password to your account' }}
          </p>
        </div>
      </div>

      <div
        v-if="hasPassword"
        class="space-y-4"
      >
        <div class="grid grid-cols-1 gap-4">
          <UFormField label="Current Password">
            <UInput
              v-model="currentPassword"
              type="password"
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </UFormField>

          <UFormField label="New Password">
            <UInput
              v-model="newPassword"
              type="password"
              placeholder="••••••••"
              autocomplete="new-password"
            />
          </UFormField>

          <UFormField label="Confirm Password">
            <UInput
              v-model="confirmPassword"
              type="password"
              placeholder="••••••••"
              autocomplete="new-password"
              @keyup.enter="changePassword"
            />
          </UFormField>
        </div>

        <div class="flex items-center justify-between pt-2">
          <p class="text-xs text-muted-foreground">
            Changing your password will sign you out of other devices.
          </p>
          <UButton
            :loading="updatingPassword"
            :disabled="!currentPassword || !newPassword || !confirmPassword"
            @click="changePassword"
          >
            Update Password
          </UButton>
        </div>
      </div>

      <div
        v-else
        class="flex items-center gap-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <UIcon
          name="i-lucide-info"
          class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0"
        />
        <div class="flex-1">
          <p class="text-sm text-amber-800 dark:text-amber-200">
            You signed up with a social account. To add a password, use the "Forgot Password" option on the sign-in page.
          </p>
        </div>
        <NuxtLink
          to="/forgot-password"
          class="shrink-0"
        >
          <UButton
            variant="outline"
            size="sm"
          >
            Set Password
          </UButton>
        </NuxtLink>
      </div>
    </div>

    <!-- Trusted Devices -->
    <SettingsSessionsSection />

    <!-- Connected Accounts -->
    <div class="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
      <h2 class="text-lg font-semibold mb-4">
        Connected Accounts
      </h2>

      <div
        v-if="loadingAccounts"
        class="flex justify-center py-4"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="w-6 h-6 animate-spin text-muted-foreground"
        />
      </div>

      <div
        v-else
        class="space-y-3"
      >
        <div
          v-for="provider in socialProviders"
          :key="provider.id"
          class="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <UIcon
              :name="provider.icon"
              class="w-5 h-5"
            />
            <span class="font-medium">{{ provider.name }}</span>
          </div>

          <template v-if="accounts.some(a => a.providerId === provider.id)">
            <UButton
              color="red"
              variant="ghost"
              size="sm"
              :loading="unlinkingAccount === provider.id"
              :disabled="accounts.length <= 1"
              @click="unlinkAccount(provider.id)"
            >
              Disconnect
            </UButton>
          </template>
          <template v-else>
            <UButton
              variant="outline"
              size="sm"
              :loading="linkingAccount === provider.id"
              @click="linkAccount(provider.id)"
            >
              Connect
            </UButton>
          </template>
        </div>

        <!-- Credential account indicator -->
        <div
          v-if="hasPassword"
          class="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-key-round"
              class="w-5 h-5"
            />
            <span class="font-medium">Email & Password</span>
          </div>
          <UBadge
            color="success"
            variant="subtle"
            size="xs"
          >
            Active
          </UBadge>
        </div>
      </div>
    </div>

    <!-- Danger Zone -->
    <div class="bg-white dark:bg-neutral-800 rounded-xl border border-red-200 dark:border-red-900 p-6">
      <h2 class="text-lg font-semibold text-red-600 dark:text-red-400 mb-4">
        Danger Zone
      </h2>

      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Once you delete your account, there is no going back. Please be certain.
        </p>

        <UButton
          color="red"
          variant="outline"
          @click="showDeleteConfirm = true"
        >
          Delete Account
        </UButton>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="showDeleteConfirm"
      title="Delete Account"
    >
      <template #body>
        <div class="space-y-4">
          <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div class="flex items-start gap-3">
              <UIcon
                name="i-lucide-alert-triangle"
                class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
              />
              <div>
                <h3 class="font-semibold text-red-800 dark:text-red-200">
                  This action cannot be undone
                </h3>
                <p class="text-sm text-red-700 dark:text-red-300 mt-1">
                  This will permanently delete your account and remove all your data from our servers. You will lose access to all organizations you own.
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          @click="showDeleteConfirm = false"
        >
          Cancel
        </UButton>
        <UButton
          color="red"
          :loading="deletingAccount"
          @click="deleteAccount"
        >
          Delete My Account
        </UButton>
      </template>
    </UModal>
  </div>
</template>
