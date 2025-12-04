<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
})
</script>

<template>
  <UContainer class="py-10">
    <div class="max-w-5xl mx-auto space-y-8">
      <div class="flex flex-col gap-4">
        <div class="space-y-1">
          <h1 class="text-3xl font-semibold">
            General
          </h1>
          <p class="text-muted-500">
            Control the basics for your workspace experience like appearance and language defaults.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <LocaleToggler />
          <ClientOnly>
            <ColorModeToggler />
          </ClientOnly>
        </div>
      </div>
    </div>
  </UContainer>
</template>
