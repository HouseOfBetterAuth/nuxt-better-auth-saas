<script setup lang="ts">
const { mode } = defineProps<{
  mode: 'desktop' | 'mobile'
}>()

const navigation = []
</script>

<template>
  <div>
    <!-- Desktop Navigation -->
    <div
      v-if="mode === 'desktop'"
      class="flex items-center gap-8"
    >
      <template
        v-for="item in navigation"
        :key="item.label"
      >
        <NuxtLink
          v-if="!item.external"
          :to="item.to"
          class="text-sm font-medium text-neutral-700 hover:text-primary-500 dark:text-neutral-300 dark:hover:text-primary-400"
        >
          {{ item.label }}
        </NuxtLink>
        <a
          v-else
          :href="item.to"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-medium text-neutral-700 hover:text-primary-500 dark:text-neutral-300 dark:hover:text-primary-400"
        >
          {{ item.label }}
        </a>
      </template>
    </div>

    <!-- Mobile Navigation -->
    <div v-if="mode === 'mobile'">
      <UDropdownMenu :items="navigation">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-menu"
          aria-label="menu"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
