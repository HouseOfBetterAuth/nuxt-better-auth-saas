<script setup lang="ts">
defineProps<{
  sidebarLabel?: string
  conversationLabel?: string
}>()
</script>

<template>
  <div class="codex-chat-layout grid gap-4 lg:grid-cols-[320px,1fr]">
    <aside class="flex flex-col gap-4 rounded-3xl border border-muted-200/70 bg-background/80 p-4">
      <div
        v-if="sidebarLabel"
        class="text-xs uppercase tracking-wide text-muted-500"
      >
        {{ sidebarLabel }}
      </div>
      <slot name="sidebar" />
    </aside>

    <section class="flex flex-col rounded-3xl border border-muted-200/70 bg-background/80">
      <header class="border-b border-muted-200/70 px-6 py-4">
        <slot name="header" />
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-4">
        <div
          v-if="conversationLabel"
          class="mb-3 text-xs uppercase tracking-wide text-muted-500"
        >
          {{ conversationLabel }}
        </div>
        <slot name="messages" />
      </div>

      <footer class="border-t border-muted-200/70 px-6 py-4 bg-muted/40">
        <slot name="composer" />
      </footer>
    </section>
  </div>
</template>
