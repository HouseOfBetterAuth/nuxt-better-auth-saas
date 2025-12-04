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
    <header class="sticky top-0 z-40 border-b border-muted-300/60 bg-background/80 backdrop-blur">
      <UContainer class="py-3">
        <div
          v-if="workspaceHeader"
          class="flex flex-wrap items-center gap-3"
        >
          <div class="flex items-stretch gap-3 min-w-0 flex-1">
            <div class="flex items-center">
              <UButton
                v-if="workspaceHeader.showBackButton"
                icon="i-lucide-arrow-left"
                variant="ghost"
                size="sm"
                class="h-10 w-10 rounded-full"
                @click="workspaceHeader.onBack?.()"
              />
            </div>
            <div class="min-w-0 flex flex-col gap-1">
              <p class="text-base font-semibold truncate">
                {{ workspaceHeader.title }}
              </p>
            </div>
          </div>
        </div>
      </UContainer>
    </header>

    <main class="flex-1 w-full pt-4 pb-4">
      <slot />
    </main>
  </div>
</template>
