<script lang="ts" setup>
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import OnboardingModal from '~/components/OnboardingModal.vue'
import UserNavigation from '~/components/UserNavigation.vue'

const { needsOnboarding, showOnboarding } = useOnboarding()
const { t } = useI18n()
const localePath = useLocalePath()

watch(() => needsOnboarding.value, (needs) => {
  if (needs)
    showOnboarding()
}, { immediate: true })

const i18nHead = useLocaleHead()
const route = useRoute()

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))

// Workspace header state
const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => false)

// Page title state - pages can set this via provide
const headerTitle = useState<string | null>('page-header-title', () => null)

// Reset header title on route change
watch(() => route.path, () => {
  headerTitle.value = null
})

// Simple page title
const pageTitle = computed(() => {
  // If page explicitly set title, use it
  if (headerTitle.value) {
    return headerTitle.value
  }

  // Home page always shows "Quillio"
  if (route.path === '/' || route.path === localePath('/')) {
    return t('global.appName')
  }

  return null
})

// Provide function for pages to set header title
provide('setHeaderTitle', (title: string | null) => {
  headerTitle.value = title
})

// Determine if we should show workspace header
const showWorkspaceHeader = computed(() => workspaceHeader.value !== null || workspaceHeaderLoading.value)

// Determine if we should show chat interface (Codex pattern - persistent but conditionally visible)
// Show on home page and content-related pages, hide on settings/billing/admin pages
const shouldShowChat = computed(() => {
  const path = route.path
  // Hide on admin, settings, billing, auth pages
  if (path.startsWith('/admin')
    || path.startsWith('/signin')
    || path.startsWith('/signup')
    || path.startsWith('/reset-password')
    || path.startsWith('/forgot-password')
    || path.startsWith('/accept-invite')
    || path.includes('/settings')
    || path.includes('/billing')
    || path.includes('/members')
    || path.includes('/integrations')
    || path.includes('/profile')) {
    return false
  }
  // Show on home, content pages, and organization pages
  return true
})

const primaryActionColor = computed(() => {
  return (workspaceHeader.value?.primaryActionColor ?? 'primary') as 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header
      class="border-b border-gray-200/50 dark:border-gray-800/50 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm"
      :class="[
        showWorkspaceHeader ? 'sticky top-0 z-40' : ''
      ]"
    >
      <div
        class="max-w-3xl mx-auto w-full"
        :class="[
          showWorkspaceHeader ? 'px-4 py-4' : 'px-4 py-3'
        ]"
      >
        <!-- Workspace Header -->
        <div
          v-if="showWorkspaceHeader"
          class="space-y-3 w-full"
        >
          <div
            v-if="workspaceHeaderLoading"
            class="flex items-start gap-3 w-full"
          >
            <div class="flex-shrink-0 pt-1.5">
              <USkeleton class="h-10 w-10 rounded-full" />
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center gap-2 min-w-0">
                <USkeleton class="h-4 w-40 max-w-full rounded-md" />
                <USkeleton class="h-4 w-12 rounded-full" />
              </div>
              <div class="flex items-center gap-2">
                <USkeleton class="h-3 w-20 rounded" />
                <USkeleton class="h-3 w-16 rounded" />
                <USkeleton class="h-3 w-28 rounded" />
              </div>
            </div>
          </div>

          <div
            v-else-if="workspaceHeader"
            class="space-y-3 w-full"
          >
            <div class="flex items-start gap-3 w-full">
              <div class="flex-shrink-0 pt-1.5">
                <UButton
                  v-if="workspaceHeader.showBackButton"
                  icon="i-lucide-arrow-left"
                  variant="ghost"
                  size="sm"
                  aria-label="Go back"
                  class="h-10 w-10 rounded-full p-0 flex items-center justify-center"
                  @click="workspaceHeader.onBack?.()"
                />
              </div>
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-2 min-w-0">
                  <p class="text-base font-semibold truncate">
                    {{ workspaceHeader.title }}
                  </p>
                  <UBadge
                    v-if="workspaceHeader.status"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="capitalize"
                  >
                    {{ workspaceHeader.status }}
                  </UBadge>
                </div>
                <div class="text-xs text-muted-500 flex flex-wrap items-center gap-1">
                  <span>{{ workspaceHeader.updatedAtLabel || '—' }}</span>
                  <template v-if="workspaceHeader.contentType">
                    <span>·</span>
                    <span class="capitalize">
                      {{ workspaceHeader.contentType }}
                    </span>
                  </template>
                  <template v-if="workspaceHeader.contentId">
                    <span>·</span>
                    <span class="font-mono text-[11px] text-muted-600 truncate">
                      {{ workspaceHeader.contentId }}
                    </span>
                  </template>
                  <template v-if="workspaceHeader.contentType || workspaceHeader.contentId">
                    <span>·</span>
                  </template>
                  <span class="text-emerald-500 dark:text-emerald-400">
                    +{{ workspaceHeader.additions ?? 0 }}
                  </span>
                  <span class="text-rose-500 dark:text-rose-400">
                    -{{ workspaceHeader.deletions ?? 0 }}
                  </span>
                </div>
              </div>
              <div
                v-if="workspaceHeader.onArchive || workspaceHeader.onShare || workspaceHeader.onPrimaryAction"
                class="flex items-center gap-2 flex-wrap justify-end"
              >
                <UButton
                  v-if="workspaceHeader.onShare"
                  icon="i-lucide-copy"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  @click="workspaceHeader.onShare?.()"
                >
                  Copy MDX
                </UButton>
                <UButton
                  v-if="workspaceHeader.onArchive"
                  icon="i-lucide-archive"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  @click="workspaceHeader.onArchive?.()"
                >
                  Archive
                </UButton>
                <UButton
                  v-if="workspaceHeader.onPrimaryAction"
                  :color="primaryActionColor"
                  :icon="workspaceHeader.primaryActionIcon ?? 'i-lucide-arrow-right'"
                  size="sm"
                  :disabled="workspaceHeader.primaryActionDisabled"
                  @click="workspaceHeader.onPrimaryAction?.()"
                >
                  {{ workspaceHeader.primaryActionLabel || 'Continue' }}
                </UButton>
              </div>
            </div>
            <div
              v-if="workspaceHeader?.tabs"
              class="w-full border-b border-gray-200/50 dark:border-gray-800/50"
            >
              <UTabs
                :items="workspaceHeader.tabs.items"
                :model-value="workspaceHeader.tabs.modelValue"
                variant="pill"
                size="sm"
                :content="false"
                class="w-full"
                @update:model-value="(value: string | number) => workspaceHeader.tabs?.onUpdate?.(String(value))"
              />
            </div>
          </div>
        </div>

        <!-- Simple Header -->
        <div
          v-else
          class="flex items-center justify-between gap-3 w-full"
        >
          <div class="flex-1 flex items-center justify-start min-w-0">
            <slot name="header-title">
              <h1
                v-if="pageTitle"
                class="text-lg font-semibold text-left truncate"
              >
                {{ pageTitle }}
              </h1>
            </slot>
          </div>
          <div class="flex items-center gap-2">
            <UserNavigation />
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full">
      <div
        class="max-w-3xl mx-auto w-full px-4"
        :class="[
          showWorkspaceHeader ? 'py-6' : ''
        ]"
      >
        <!-- Chat interface - persistent like Codex, conditionally visible -->
        <ClientOnly>
          <ChatQuillioWidget v-if="shouldShowChat" />
        </ClientOnly>
        <!-- Show page content when chat is hidden -->
        <div v-if="!shouldShowChat">
          <slot />
        </div>
      </div>
    </main>
    <OnboardingModal />
  </div>
</template>
