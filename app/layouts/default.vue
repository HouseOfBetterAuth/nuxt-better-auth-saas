<script lang="ts" setup>
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import { stripLocalePrefix } from '~~/shared/utils/routeMatching'
import AuthModal from '~/components/AuthModal.vue'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import SidebarNavigation from '~/components/SidebarNavigation.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn, signOut, useActiveOrganization } = useAuth()
const conversation = useConversation()
const activeOrg = useActiveOrganization()

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

const normalizeRouteParam = (param?: string | string[]) => {
  if (Array.isArray(param))
    return param[0]
  if (typeof param === 'string')
    return param
  return undefined
}

const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  if (routeSlug && routeSlug !== 't')
    return routeSlug
  const fallback = activeOrg.value?.data?.slug
  return fallback && fallback !== 't' ? fallback : null
})

const userMenuItems = computed(() => {
  const items: any[] = []
  if (orgSlug.value) {
    items.push({
      label: t('global.nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath(`/${orgSlug.value}/settings`)
    })
  }
  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })
  return items
})

const contentId = computed(() => {
  if (!contentRouteMatch.value)
    return undefined
  const id = normalizeRouteParam(route.params.id)
  return id || contentRouteMatch.value[1]
})

const {
  items: conversationItems,
  pending: conversationPending,
  error: conversationError,
  hasMore: conversationHasMore,
  initialized: conversationInitialized,
  loadInitial: loadConversationInitial,
  loadMore: loadConversationMore,
  remove: removeConversation,
  refresh: refreshConversation,
  reset: resetConversationList
} = useConversationList({ pageSize: 40, stateKey: 'shell' })

const chatView = ref<'chat' | 'list'>('chat')
const archivingConversationId = ref<string | null>(null)
const conversationsExpanded = ref(false)

watch(() => shouldShowChatPanel.value, (next) => {
  if (!next) {
    chatView.value = 'chat'
    conversationsExpanded.value = false
    return
  }
  if (!import.meta.client)
    return
  if (conversationPending.value && !conversationInitialized.value)
    resetConversationList()
  loadConversationInitial().catch(() => {})
})

onMounted(() => {
  if (!shouldShowChatPanel.value)
    return
  if (conversationPending.value && !conversationInitialized.value)
    resetConversationList()
  loadConversationInitial().catch(() => {})
})

watch(loggedIn, (value, previous) => {
  if (value === previous)
    return
  resetConversationList()
  if (!import.meta.client)
    return
  if (value && shouldShowChatPanel.value)
    loadConversationInitial().catch(() => {})
})

const toggleChatView = () => {
  chatView.value = chatView.value === 'chat' ? 'list' : 'chat'
  conversationsExpanded.value = false
}

const startNewChat = () => {
  chatView.value = 'chat'
  conversation.conversationId.value = null
  conversation.resetConversation()
  conversation.prompt.value = ''
}

const selectConversation = (id: string) => {
  chatView.value = 'chat'
  conversation.conversationId.value = id
}

const chatTitle = computed(() => {
  if (chatView.value === 'list')
    return 'Conversations'
  const id = conversation.conversationId.value
  if (!id)
    return 'New chat'
  const match = conversationItems.value.find(item => item.id === id)
  return match?.displayLabel || 'Chat'
})

const archiveConversation = async (conversationId: string, event?: Event) => {
  event?.stopPropagation()
  if (!conversationId || archivingConversationId.value === conversationId)
    return

  archivingConversationId.value = conversationId
  try {
    await $fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' })
    removeConversation(conversationId)

    if (conversation.conversationId.value === conversationId)
      startNewChat()

    await refreshConversation().catch(() => {})
  } catch (error) {
    console.error('Failed to archive conversation', error)
  } finally {
    archivingConversationId.value = null
  }
}

const visibleConversationItems = computed(() => {
  if (conversationsExpanded.value)
    return conversationItems.value
  return conversationItems.value.slice(0, 3)
})

const canExpandConversationList = computed(() => {
  return !conversationsExpanded.value && (conversationItems.value.length > 3 || conversationHasMore.value)
})
</script>

<template>
  <div class="relative min-h-screen bg-white dark:bg-neutral-950 lg:h-screen lg:overflow-hidden">
    <div class="flex min-h-screen flex-col lg:h-full lg:min-h-0 lg:flex-row">
      <UDashboardSidebar
        v-if="shouldRenderAppShell"
        class="flex-shrink-0 w-full border-b border-neutral-200/70 dark:border-neutral-800/60 lg:h-full lg:w-64 lg:border-b-0 lg:border-r xl:w-72"
        collapsible
        :ui="{
          root: 'h-full bg-neutral-100 dark:bg-neutral-950 border-none'
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

        <template #footer />
      </UDashboardSidebar>

      <div class="flex min-h-0 flex-1 flex-col">
        <UDashboardNavbar :toggle="shouldRenderAppShell">
          <template
            v-if="showWorkspaceHeader"
            #left
          >
            <slot name="workspace-header">
              <p
                v-if="workspaceHeader"
                class="text-base font-semibold truncate"
              >
                {{ workspaceHeader.title }}
              </p>
            </slot>
          </template>

          <template
            v-else
            #left
          >
            <NuxtLink
              :to="localePath('/')"
              class="mr-4 flex items-center gap-2 hover:opacity-80 transition-opacity"
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
          <div class="h-full w-full">
            <slot />
          </div>
        </div>
      </div>

      <aside
        v-if="shouldShowChatPanel"
        class="flex w-full min-h-0 flex-col border-t border-neutral-200/70 bg-white dark:border-neutral-800/60 dark:bg-neutral-950 max-lg:h-[60vh] lg:h-full lg:w-[400px] lg:border-t-0 lg:border-l"
      >
        <div class="flex items-center gap-2 border-b border-neutral-200/70 px-2 py-2 dark:border-neutral-800/60">
          <UButton
            aria-label="Back"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-arrow-left"
            @click="toggleChatView"
          />
          <p class="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            {{ chatTitle }}
          </p>
          <UDropdownMenu
            v-if="loggedIn"
            :items="userMenuItems"
          >
            <UButton
              aria-label="Settings"
              variant="ghost"
              color="neutral"
              size="xs"
              icon="i-lucide-settings"
            />
          </UDropdownMenu>
          <UButton
            aria-label="New chat"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-square-pen"
            @click="startNewChat"
          />
        </div>

        <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div
            v-if="chatView === 'list'"
            class="flex-1 min-h-0 overflow-y-auto"
          >
            <div class="p-3">
              <UAlert
                v-if="conversationError"
                color="error"
                variant="soft"
                title="Failed to load conversations"
                :description="conversationError"
              />
            </div>

            <div class="space-y-1 px-2 pb-2">
              <template v-if="conversationInitialized && visibleConversationItems.length">
                <div
                  v-for="entry in visibleConversationItems"
                  :key="entry.id"
                  class="group relative w-full rounded-md border border-transparent transition-colors"
                  :class="conversation.conversationId.value === entry.id
                    ? 'bg-neutral-100/80 dark:bg-neutral-800/60'
                    : 'hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40'"
                >
                  <button
                    type="button"
                    class="w-full rounded-md px-3 py-2 text-left"
                    @click="selectConversation(entry.id)"
                  >
                    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                      <p class="text-sm font-semibold truncate">
                        {{ entry.displayLabel }}
                      </p>
                      <div class="flex items-center justify-end gap-2 font-mono text-xs tabular-nums">
                        <span
                          v-if="(entry.additions || 0) > 0"
                          class="text-emerald-500 dark:text-emerald-400"
                        >
                          +{{ entry.additions }}
                        </span>
                        <span
                          v-if="(entry.deletions || 0) > 0"
                          class="text-rose-500 dark:text-rose-400"
                        >
                          -{{ entry.deletions }}
                        </span>
                      </div>
                      <p class="text-xs text-muted-foreground text-right">
                        {{ entry.updatedAgo }}
                      </p>
                    </div>
                  </button>
                  <UButton
                    icon="i-lucide-archive"
                    size="2xs"
                    color="neutral"
                    variant="ghost"
                    :loading="archivingConversationId === entry.id"
                    :disabled="archivingConversationId === entry.id"
                    class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Archive conversation"
                    @click="archiveConversation(entry.id, $event)"
                  />
                </div>
              </template>

              <template v-else-if="conversationPending && !conversationInitialized">
                <div
                  v-for="n in 8"
                  :key="n"
                  class="rounded-md border border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2"
                >
                  <USkeleton class="h-4 w-3/4" />
                  <USkeleton class="h-3 w-1/3 mt-2" />
                </div>
              </template>

              <p
                v-else
                class="text-sm text-muted-foreground px-3 py-6 text-center"
              >
                No conversations yet.
              </p>
            </div>

            <div class="flex justify-center px-3 pb-2">
              <UButton
                v-if="canExpandConversationList"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="conversationsExpanded = true"
              >
                View all
              </UButton>
              <UButton
                v-else-if="conversationsExpanded && conversationItems.length > 3"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="conversationsExpanded = false"
              >
                Show less
              </UButton>
            </div>

            <div class="flex justify-center px-3 pb-4">
              <UButton
                v-if="conversationsExpanded && conversationHasMore"
                color="neutral"
                variant="outline"
                size="sm"
                :loading="conversationPending"
                @click="loadConversationMore()"
              >
                Load more
              </UButton>
            </div>
          </div>

          <QuillioWidget
            class="flex-1 min-h-0"
            :content-id="contentId"
            :conversation-id="conversation.conversationId.value"
            :sync-route="false"
            :use-route-conversation-id="false"
            :show-messages="chatView !== 'list'"
            embedded
          />
        </div>
      </aside>
    </div>
    <OnboardingModal />
    <AuthModal
      v-model:open="authModalOpen"
      v-model:mode="authModalMode"
    />
  </div>
</template>
