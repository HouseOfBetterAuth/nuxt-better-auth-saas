<script setup lang="ts">
import type { WorkspaceHeaderState } from '../components/chat/workspaceHeader'

const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const i18nHead = useLocaleHead()

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header class="sticky top-0 z-40 border-b border-neutral-200/70 dark:border-neutral-800/60 bg-background/95 backdrop-blur-sm shadow-sm">
      <div class="px-4 py-4 max-w-3xl mx-auto w-full">
        <div v-if="workspaceHeader" class="space-y-3 w-full">
          <div class="flex items-start gap-3 w-full">
            <div class="flex-shrink-0 pt-1.5">
              <UButton
                v-if="workspaceHeader.showBackButton"
                icon="i-lucide-arrow-left"
                variant="ghost"
                size="sm"
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
                <span>·</span>
                <span class="text-emerald-500 dark:text-emerald-400">
                  +{{ workspaceHeader.additions ?? 0 }}
                </span>
                <span class="text-rose-500 dark:text-rose-400">
                  -{{ workspaceHeader.deletions ?? 0 }}
                </span>
              </div>
            </div>
          </div>
          <div
            v-if="workspaceHeader.tabs"
            class="w-full border-b border-neutral-200/60 dark:border-neutral-800/60"
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
    </header>

    <main class="flex-1 w-full">
      <div class="max-w-3xl mx-auto w-full px-4 py-6">
        <slot />
      </div>
    </main>
  </div>
</template>
