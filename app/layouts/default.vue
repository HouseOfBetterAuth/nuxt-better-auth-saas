<script lang="ts" setup>
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'
import Logo from '~/components/Logo.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import SidebarNavigation from '~/components/SidebarNavigation.vue'
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
  if (headerTitle.value) {
    return headerTitle.value
  }
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

// Helper to check if current path matches a route pattern (accounting for locale)
const isRouteMatch = (pattern: string) => {
  const localizedPattern = localePath(pattern)
  return route.path.startsWith(localizedPattern) || route.path.startsWith(pattern)
}

// Determine if we should show chat interface - only on conversation routes
const shouldShowChat = computed(() => {
  return isRouteMatch('/conversations')
})

// Determine if we should show sidebar - on conversations and content routes
const shouldShowSidebar = computed(() => {
  return isRouteMatch('/conversations') || isRouteMatch('/content')
})

const primaryActionColor = computed(() => {
  return (workspaceHeader.value?.primaryActionColor ?? 'primary') as 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
})
</script>

<template>
  <div>
    <UDashboardGroup
      storage-key="dashboard-sidebar"
      storage="localStorage"
    >
      <!-- Sidebar with tabs for conversations and content -->
      <UDashboardSidebar
        v-if="shouldShowSidebar"
        collapsible
        resizable
      >
        <template #header="{ collapsed }">
          <div
            v-if="!collapsed"
            class="flex items-center gap-2"
          >
            <Logo class="h-5 w-auto shrink-0" />
            <span class="text-sm font-semibold">{{ t('global.appName') }}</span>
          </div>
          <UIcon
            v-else
            name="i-simple-icons-nuxtdotjs"
            class="size-5 text-primary mx-auto"
          />
        </template>

        <template #default="{ collapsed }">
          <SidebarNavigation v-if="!collapsed" />
          <div
            v-else
            class="flex flex-col items-center gap-2 py-4"
          >
            <UIcon
              name="i-lucide-message-circle"
              class="w-5 h-5 text-muted-500"
            />
            <UIcon
              name="i-lucide-file-text"
              class="w-5 h-5 text-muted-500"
            />
          </div>
        </template>

        <template #footer="{ collapsed }">
          <div
            v-if="!collapsed"
            class="w-full"
          >
            <UserNavigation />
          </div>
        </template>
      </UDashboardSidebar>

      <!-- Main content panel -->
      <UDashboardPanel>
        <template #header>
          <UDashboardNavbar>
            <template
              v-if="showWorkspaceHeader"
              #left
            >
              <div class="flex items-center gap-3 w-full">
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
                  class="flex items-start gap-3 w-full"
                >
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
                  <div class="flex items-center gap-2 flex-wrap justify-end">
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
              </div>
            </template>

            <template
              v-else
              #left
            >
              <NuxtLink
                :to="localePath('/')"
                class="flex items-center gap-2 hover:opacity-80 transition-opacity mr-4"
              >
                <Logo class="h-6 w-6" />
              </NuxtLink>
              <slot name="header-title">
                <h1
                  v-if="pageTitle"
                  class="text-lg font-semibold text-left truncate"
                >
                  {{ pageTitle }}
                </h1>
              </slot>
            </template>

            <template #right>
              <UserNavigation v-if="!shouldShowSidebar" />
            </template>
          </UDashboardNavbar>
        </template>

        <div class="flex-1 overflow-y-auto min-h-0">
          <div
            class="w-full mx-auto"
            :class="shouldShowChat ? 'h-full' : 'max-w-3xl px-4 py-6'"
          >
            <!-- Chat interface - only on conversation routes -->
            <ClientOnly>
              <QuillioWidget v-if="shouldShowChat" />
            </ClientOnly>
            <!-- Show page content for all other routes -->
            <div v-if="!shouldShowChat">
              <slot />
            </div>
          </div>
        </div>
      </UDashboardPanel>
    </UDashboardGroup>
    <OnboardingModal />
  </div>
</template>
