<script setup lang="ts">
import { useRoute } from 'vue-router'

interface WhatsNewCard {
  id: 'youtube' | 'transcript' | 'seo'
  title: string
  icon: string
  disabled?: boolean
  href?: string
}

const route = useRoute()
const slug = computed(() => {
  const slugParam = route.params.slug
  return (Array.isArray(slugParam) ? slugParam[0] : slugParam) || ''
})

const cards = computed<WhatsNewCard[]>(() => [
  {
    id: 'youtube',
    title: 'Blog from YouTube',
    icon: 'i-simple-icons-youtube',
    href: slug.value ? `/${slug.value}/integrations` : undefined
  },
  {
    id: 'transcript',
    title: 'Blog from Context',
    icon: 'i-lucide-file-text',
    disabled: true
  },
  {
    id: 'seo',
    title: 'Enable SEO Review',
    icon: 'i-lucide-sparkles',
    disabled: true
  }
])
</script>

<template>
  <div class="w-full space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-sm font-semibold text-muted-700 dark:text-muted-200">
        What's new from Quillio
      </p>
    </div>
    <div class="grid gap-3 sm:grid-cols-3">
      <UButton
        v-for="card in cards"
        :key="card.id"
        variant="ghost"
        color="neutral"
        :disabled="card.disabled"
        :to="card.href"
        class="group flex items-center gap-3 rounded-2xl px-5 py-4 text-left justify-start h-auto bg-muted"
      >
        <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted-200 dark:bg-muted-800">
          <UIcon
            :name="card.icon"
            class="h-5 w-5 text-primary-400"
          />
        </div>
        <span class="text-sm font-medium whitespace-nowrap">
          {{ card.title }}
        </span>
      </UButton>
    </div>
  </div>
</template>
