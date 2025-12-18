<script lang="ts" setup>
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import { stripLocalePrefix } from '~~/shared/utils/routeMatching'
import AuthModal from '~/components/AuthModal.vue'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import SidebarNavigation from '~/components/SidebarNavigation.vue'
import UserNavigation from '~/components/UserNavigation.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn, useActiveOrganization } = useAuth()
const _activeOrg = useActiveOrganization()

// Keep in sync with `app/middleware/auth.global.ts`
const KNOWN_LOCALES = ['en', 'zh-CN', 'ja', 'fr']

const i18nHead = useLocaleHead()
const route = useRoute()

const authModalOpen = ref(false)
const authModalMode = ref<'signin' | 'signup'>('signin')

function openSignInModal(event?: MouseEvent) {
  event?.preventDefault()
  authModalMode.value = 'signin'
  authModalOpen.value = true
}

function openSignUpModal(event?: MouseEvent) {
  event?.preventDefault()
  authModalMode.value = 'signup'
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
// Reset header title on route change
watch(() => route.path, () => {
  headerTitle.value = null
})

// Simple page title
const pageTitle = computed(() => {
  if (headerTitle.value) {
    return headerTitle.value
  }
  return null
})

// Provide function for pages to set header title
provide('setHeaderTitle', (title: string | null) => {
  headerTitle.value = title
})

const pathWithoutLocale = computed(() => stripLocalePrefix(route.path, KNOWN_LOCALES))

// Workspace header routes (content detail pages).
const isWorkspaceHeaderRoute = computed(() => {
  return /^\/[^/]+\/content\/[^/]+(?:\/|$)/.test(pathWithoutLocale.value)
})

// Always show the workspace header shell on content detail routes.
// The page itself is client-only (`ssr: false`), so we can't rely on the page component
// to populate `workspaceHeader` during SSR. Rendering the shell avoids SSR/client
// structure divergence (hydration mismatches) and ensures the top header is visible.
const showWorkspaceHeader = computed(() => isWorkspaceHeaderRoute.value)

const authRoutePrefixes = ['/signin', '/signup', '/forgot-password', '/reset-password']

const isAuthPage = computed(() => {
  const path = pathWithoutLocale.value
  return authRoutePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
})

const isPublicPage = computed(() => route.meta?.auth === false)

const shouldRenderAppShell = computed(() => loggedIn.value && !isAuthPage.value && !isPublicPage.value)

const shouldShowChatPanel = computed(() => shouldRenderAppShell.value && route.meta?.renderChatWidget !== false)

const contentRouteMatch = computed(() => pathWithoutLocale.value.match(/^\/[^/]+\/content\/([^/]+)(?:\/|$)/))
const conversationRouteMatch = computed(() => pathWithoutLocale.value.match(/^\/[^/]+\/conversations\/([^/]+)(?:\/|$)/))

const normalizeRouteParam = (param?: string | string[]) => {
  if (Array.isArray(param))
    return param[0]
  if (typeof param === 'string')
    return param
  return undefined
}

const _contentId = computed(() => {
  if (!contentRouteMatch.value)
    return undefined
  const id = normalizeRouteParam(route.params.id)
  return id || contentRouteMatch.value[1]
})

const _conversationId = computed(() => {
  if (!conversationRouteMatch.value)
    return undefined
  const id = normalizeRouteParam(route.params.id)
  return id || conversationRouteMatch.value[1]
})

const chatCollapsed = ref(false)

watch(() => shouldShowChatPanel.value, (next) => {
  if (!next)
    chatCollapsed.value = false
})

const _toggleChatPanel = () => {
  chatCollapsed.value = !chatCollapsed.value
}

const primaryActionColor = computed(() => {
  return (workspaceHeader.value?.primaryActionColor ?? 'primary') as 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
})
</script>

<template>
  <div class="relative overflow-x-hidden">
    <UDashboardGroup>
      <!-- Sidebar with tabs for conversations and content -->
      <UDashboardSidebar
        v-if="shouldShowSidebar"
        collapsible
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
        <UDashboardNavbar
          :toggle="shouldShowSidebar"
          :class="loggedIn && !showWorkspaceHeader ? 'lg:hidden' : ''"
        >
          <template
            v-if="showWorkspaceHeader"
            #left
          >
            <div class="flex flex-col gap-3 w-full lg:flex-row lg:items-center lg:justify-between">
              <div
                v-if="workspaceHeaderLoading || !workspaceHeader"
                class="flex items-center gap-3 w-full"
              >
                <USkeleton class="h-10 w-10 rounded-full flex-shrink-0" />
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
                v-else
                class="flex flex-col gap-3 w-full lg:flex-row lg:items-center lg:justify-between"
              >
                <div class="flex items-center gap-2 w-full lg:w-auto">
                  <UButton
                    v-if="workspaceHeader.showBackButton"
                    icon="i-lucide-arrow-left"
                    variant="ghost"
                    size="sm"
                    :aria-label="t('global.back')"
                    class="rounded-full p-0 h-10 w-10 flex items-center justify-center"
                    @click="workspaceHeader.onBack?.()"
                  />
                  <p class="text-base font-semibold truncate">
                    {{ workspaceHeader.title }}
                  </p>
                  <UBadge
                    v-if="workspaceHeader.status"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="capitalize hidden lg:inline-flex"
                  >
                    {{ workspaceHeader.status }}
                  </UBadge>
                </div>
                <div class="text-xs text-muted-500 hidden lg:flex flex-wrap items-center gap-1">
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
                <div class="hidden lg:flex flex-wrap gap-2 justify-end">
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
              <span class="text-sm font-semibold">
                {{ t('global.appName') }}
              </span>
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
            <div
              v-if="!loggedIn"
              class="flex items-center gap-2"
            >
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                @click="openSignInModal"
              >
                {{ t('global.auth.signIn') }}
              </UButton>
              <UButton
                color="primary"
                size="sm"
                @click="openSignUpModal"
              >
                {{ t('global.auth.signUp') }}
              </UButton>
            </div>
          </template>
        </UDashboardNavbar>

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
      </UDashboardPanel>
    </UDashboardGroup>
    <OnboardingModal />
    <AuthModal
      v-model:open="authModalOpen"
      v-model:mode="authModalMode"
    />
  </div>
</template>
