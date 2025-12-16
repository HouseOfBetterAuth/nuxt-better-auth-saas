<script lang="ts" setup>
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import AuthModal from '~/components/AuthModal.vue'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'
import Logo from '~/components/Logo.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import SidebarNavigation from '~/components/SidebarNavigation.vue'
import UserNavigation from '~/components/UserNavigation.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const router = useRouter()
const { loggedIn } = useAuth()

const i18nHead = useLocaleHead()
const route = useRoute()

const authModalOpen = ref(false)
const authModalMode = ref<'signin' | 'signup'>('signin')

function openSignInModal(event?: MouseEvent) {
  event?.preventDefault()
  authModalMode.value = 'signin'
  authModalOpen.value = true
}

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))

// Workspace header state
const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => false)

// Page title state - pages can set this via provide
const headerTitle = useState<string | null>('page-header-title', () => null)
const mobileSidebarOpen = ref(false)

// Reset header title on route change
watch(() => route.path, () => {
  headerTitle.value = null
  mobileSidebarOpen.value = false
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

const normalizePathForMatch = (value: string) => {
  if (!value)
    return ''
  if (value === '/')
    return '/'
  return value.endsWith('/') ? value : `${value}/`
}

const ensureLeadingSlash = (value: string) => value.startsWith('/') ? value : `/${value}`

const buildRouteCandidates = (pattern: string) => {
  const normalizedPattern = ensureLeadingSlash(pattern)
  const candidates = new Set<string>()
  const localizedPattern = localePath(normalizedPattern)

  candidates.add(normalizePathForMatch(normalizedPattern))
  if (localizedPattern)
    candidates.add(normalizePathForMatch(localizedPattern))

  return Array.from(candidates).filter(Boolean)
}

const isRouteMatch = (pattern: string) => {
  const currentPath = normalizePathForMatch(route.path)
  return buildRouteCandidates(pattern).some(candidate => currentPath.startsWith(candidate))
}

// Determine if we should show chat interface - only on conversation routes
const shouldShowChat = computed(() => {
  if (route.meta?.renderChatWidget === false)
    return false
  return isRouteMatch('/conversations')
})

// Determine if we should show sidebar - on conversations and content routes
const shouldShowSidebar = computed(() => {
  const path = normalizePathForMatch(route.path)
  return isRouteMatch('/conversations') || path.includes('/content/')
})

// Determine if we should use full-width layout (conversations and content pages)
const shouldUseFullWidth = computed(() => {
  return isRouteMatch('/conversations') || isRouteMatch('/content')
})

const primaryActionColor = computed(() => {
  return (workspaceHeader.value?.primaryActionColor ?? 'primary') as 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
})
</script>

<template>
  <div class="relative overflow-x-hidden">
    <!-- Mobile Header - only visible on mobile when sidebar should be shown -->
    <header
      v-if="shouldShowSidebar"
      class="lg:hidden border-b border-neutral-200/70 dark:border-neutral-800/60 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm sticky top-0 z-50"
    >
      <div class="px-4 py-2 flex items-center justify-between w-full">
        <!-- Mobile navigation triggers -->
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Menu"
            @click="mobileSidebarOpen = true"
          />

          <UButton
            icon="i-lucide-message-square-plus"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('global.conversations.new')"
            @click="router.push(localePath('/conversations'))"
          />
        </div>

        <!-- Right side: User Navigation -->
        <div class="flex items-center gap-2">
          <UserNavigation @sign-in="openSignInModal" />
        </div>
      </div>
    </header>

    <USlideover
      v-model:open="mobileSidebarOpen"
      side="left"
      :handle="false"
      title="Navigation menu"
      description="Browse workspace sections and account options."
    >
      <template #content>
        <div class="w-[80vw] max-w-sm h-full flex flex-col bg-white dark:bg-gray-900 text-left">
          <NuxtLink
            :to="localePath('/')"
            class="px-4 pt-4 pb-2 border-b border-neutral-200/70 dark:border-neutral-800/60 flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span class="text-lg font-semibold truncate">
              {{ t('global.appName') }}
            </span>
          </NuxtLink>
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <SidebarNavigation />
          </div>
          <div class="px-4 pb-4 border-t border-neutral-200/70 dark:border-neutral-800/60">
            <UserNavigation @sign-in="openSignInModal" />
          </div>
        </div>
      </template>
    </USlideover>

    <UDashboardGroup
      storage-key="dashboard-sidebar"
      storage="local"
    >
      <!-- Sidebar with tabs for conversations and content -->
      <UDashboardSidebar
        v-if="shouldShowSidebar"
        collapsible
        resizable
        :ui="{
          root: 'bg-neutral-100 dark:bg-neutral-950 border-r border-neutral-200/70 dark:border-neutral-800/60'
        }"
      >
        <template #header="{ collapsed }">
          <NuxtLink
            v-if="!collapsed"
            :to="localePath('/')"
            class="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span class="text-sm font-semibold">{{ t('global.appName') }}</span>
          </NuxtLink>
          <NuxtLink
            v-else
            :to="localePath('/')"
            class="flex items-center justify-center hover:opacity-80 transition-opacity"
            aria-label="Home"
          >
            <UIcon
              name="i-simple-icons-nuxtdotjs"
              class="size-5 text-primary"
            />
          </NuxtLink>
        </template>

        <template #default="{ collapsed }">
          <SidebarNavigation v-if="!collapsed" />
          <div
            v-else
            class="flex flex-col items-center gap-2 py-4"
          >
            <UIcon
              name="i-lucide-file-text"
              class="w-5 h-5 text-muted-500"
            />
            <UIcon
              name="i-lucide-message-circle"
              class="w-5 h-5 text-muted-500"
            />
          </div>
        </template>

        <template #footer="{ collapsed }">
          <div
            v-if="!collapsed"
            class="w-full"
          >
            <UserNavigation @sign-in="openSignInModal" />
          </div>
        </template>
      </UDashboardSidebar>

      <!-- Main content panel -->
      <UDashboardPanel>
        <template #header>
          <UDashboardNavbar
            :class="{ 'hidden lg:flex': shouldShowSidebar }"
          >
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
                      :aria-label="t('global.back')"
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
                      {{ t('content.copyMdx') }}
                    </UButton>
                    <UButton
                      v-if="workspaceHeader.onArchive"
                      icon="i-lucide-archive"
                      size="sm"
                      color="neutral"
                      variant="ghost"
                      @click="workspaceHeader.onArchive?.()"
                    >
                      {{ t('content.archive') }}
                    </UButton>
                    <UButton
                      v-if="workspaceHeader.onPrimaryAction"
                      :color="primaryActionColor"
                      :icon="workspaceHeader.primaryActionIcon ?? 'i-lucide-arrow-right'"
                      size="sm"
                      :disabled="workspaceHeader.primaryActionDisabled"
                      @click="workspaceHeader.onPrimaryAction?.()"
                    >
                      {{ workspaceHeader.primaryActionLabel || t('global.continue') }}
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
              <UserNavigation
                v-if="!shouldShowSidebar"
                @sign-in="openSignInModal"
              />
            </template>
          </UDashboardNavbar>
        </template>

        <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <div
            class="w-full mx-auto"
            :class="shouldUseFullWidth ? '' : 'max-w-3xl px-4 py-6'"
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

        <!-- Legal Disclaimer - Only for anonymous/guest users (desktop only, mobile is in QuillioWidget) -->
        <div
          v-if="!loggedIn && shouldShowChat"
          class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm px-4 py-2 hidden lg:block"
        >
          <i18n-t
            keypath="global.legal.chatDisclaimer"
            tag="p"
            class="text-xs text-muted-600 dark:text-muted-400 text-center"
          >
            <template #terms>
              <NuxtLink
                :to="localePath('/terms')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ t('global.legal.terms') }}
              </NuxtLink>
            </template>
            <template #privacy>
              <NuxtLink
                :to="localePath('/privacy')"
                class="underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ t('global.legal.privacyPolicy') }}
              </NuxtLink>
            </template>
          </i18n-t>
        </div>
      </UDashboardPanel>
    </UDashboardGroup>
    <OnboardingModal />
    <AuthModal
      v-model:open="authModalOpen"
      v-model:mode="authModalMode"
    />
  </div>
</template>
