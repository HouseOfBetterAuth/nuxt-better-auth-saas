<script setup lang="ts">
import type { WorkspaceHeaderState } from '../components/chat/workspaceHeader'

const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => false)
const i18nHead = useLocaleHead()

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    <header class="sticky top-0 z-40 border-b border-muted-200/80 dark:border-muted-800/70 bg-background/95 backdrop-blur-sm shadow-sm">
      <div
        class="px-4 py-4 max-w-3xl mx-auto w-full"
      >
        <div class="space-y-3 w-full">
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
                  icon="i-lucide-share"
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
                  :color="workspaceHeader.primaryActionColor || 'primary'"
                  icon="i-lucide-download"
                  size="sm"
                  :disabled="workspaceHeader.primaryActionDisabled"
                  @click="workspaceHeader.onPrimaryAction?.()"
                >
                  {{ workspaceHeader.primaryActionLabel || 'Continue' }}
                </UButton>
              </div>
            </div>
            <div
              v-if="workspaceHeader.tabs"
              class="w-full border-b border-muted-200/80 dark:border-muted-800/70"
            >
              <UTabs
                :items="workspaceHeader.tabs.items"
                :model-value="workspaceHeader.tabs.modelValue"
                variant="pill"
                size="sm"
                :content="false"
                class="w-full"
                @update:model-value="workspaceHeader.tabs.onUpdate?.($event)"
              />
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full">
      <div class="max-w-3xl mx-auto w-full px-4 py-6">
        <slot />
      </div>
    </main>
  </div>
</template>
