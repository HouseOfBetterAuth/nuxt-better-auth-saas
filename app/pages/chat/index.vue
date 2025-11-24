<script setup lang="ts">
import type { ChatActionSuggestion } from '~/shared/utils/types'
import { computed, ref } from 'vue'

const {
  messages,
  status,
  actions,
  errorMessage,
  generation,
  sendMessage,
  executeAction,
  isBusy
} = useChatSession()

const isPaletteOpen = ref(false)

const promptStatus = computed(() => {
  if (status.value === 'submitted' || status.value === 'streaming' || status.value === 'error') {
    return status.value as 'submitted' | 'streaming' | 'error'
  }
  return 'ready'
})

async function handleSubmit(prompt: string) {
  await sendMessage(prompt)
}

async function handleAction(action: ChatActionSuggestion) {
  await executeAction(action)
}
</script>

<template>
  <div>
    <UContainer
      class="flex flex-col gap-6 py-10"
    >
      <div
        class="space-y-2"
      >
        <h1
          class="text-3xl font-semibold"
        >
          Chat Playground
        </h1>
        <p
          class="text-muted-foreground"
        >
          Front-end preview of the upcoming Codex chat. Messages live only in local state for now.
        </p>
      </div>

      <UCard
        class="flex h-[70vh] flex-col"
      >
        <template #header>
          <div
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <h2
                class="text-lg font-semibold"
              >
                Codex Chat
              </h2>
              <p
                class="text-sm text-muted-foreground"
              >
                Connected to your backend endpoint.
              </p>
            </div>
            <UButton
              icon="i-lucide-refresh-ccw"
              variant="ghost"
              :disabled="isBusy"
              @click="sendMessage('Hello Codex!')"
            >
              Send sample
            </UButton>
          </div>
        </template>

        <div
          class="flex-1 overflow-y-auto px-2 py-4"
        >
          <ChatMessagesList
            :messages="messages"
            :status="status"
            class="h-full"
          />
        </div>
        <div
          class="border-t border-border px-4 py-3"
        >
          <div
            v-if="errorMessage"
            class="mb-3"
          >
            <UAlert
              color="error"
              variant="soft"
              icon="i-lucide-alert-triangle"
              :description="errorMessage"
            />
          </div>

          <div
            v-if="actions.length"
            class="mb-3 space-y-2"
          >
            <UAlert
              title="Suggested actions"
              description="Codex spotted something you can run."
              icon="i-lucide-bolt"
              variant="soft"
            />
            <div
              class="flex flex-wrap gap-2"
            >
              <UButton
                v-for="action in actions"
                :key="`${action.type}-${action.sourceContentId}`"
                size="sm"
                variant="outline"
                icon="i-lucide-wand-sparkles"
                :disabled="isBusy"
                :loading="isBusy"
                @click="handleAction(action)"
              >
                {{ action.label || 'Start a draft' }}
              </UButton>
            </div>
          </div>

          <div
            v-if="generation"
            class="mb-3"
          >
            <UAlert
              color="primary"
              icon="i-lucide-file-text"
              title="Draft ready"
              description="Check the Content section to review the latest version."
            />
          </div>

          <ChatPromptBar
            :status="promptStatus"
            :disabled="isBusy"
            @submit="handleSubmit"
          />
        </div>
      </UCard>

      <div
        class="flex justify-end"
      >
        <UButton
          icon="i-lucide-message-circle"
          variant="soft"
          label="Open Palette"
          @click="isPaletteOpen = true"
        />
      </div>

      <ClientOnly>
        <ChatPaletteShell
          :messages="messages"
          :status="status"
          :open="isPaletteOpen"
          :actions="actions"
          :disabled="isBusy"
          placeholder="Try the palette version…"
          @update:open="value => { isPaletteOpen = value }"
          @submit="handleSubmit"
          @action="handleAction"
        />
      </ClientOnly>
    </UContainer>
  </div>
</template>
