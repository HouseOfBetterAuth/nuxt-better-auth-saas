<i18n src="./index.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: false
})

const { t } = useI18n()
const localePath = useLocalePath()

const title = `${t('global.appName')}: ${t('home.slogan')}`
const desc = t('home.slogan')

useHead({
  title
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.(t('global.appName'))

useSeoMeta({
  title,
  description: desc,
  // Facebook
  ogTitle: title,
  ogDescription: desc,
  ogImage: '/screenshots/home.webp',
  // twitter
  twitterTitle: title,
  twitterDescription: desc,
  twitterImage: '/screenshots/home.webp'
})
</script>

<template>
  <div class="w-full">
    <!-- Hero Section -->
    <section class="py-16 sm:py-24">
      <div class="max-w-4xl mx-auto text-center space-y-6 px-4">
        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight">
          {{ t('home.slogan') }}
        </h1>
        <p class="text-lg text-muted-600 dark:text-muted-400 max-w-2xl mx-auto">
          {{ t('home.description') }}
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <UButton
            :to="localePath('/conversations')"
            size="lg"
            color="primary"
            icon="i-lucide-message-circle"
          >
            {{ t('home.startConversation') }}
          </UButton>
          <UButton
            :to="localePath('/content')"
            size="lg"
            variant="outline"
            icon="i-lucide-file-text"
          >
            {{ t('home.viewContent') }}
          </UButton>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section class="py-16 border-t border-muted-200 dark:border-muted-800">
      <div class="max-w-6xl mx-auto px-4">
        <h2 class="text-2xl font-semibold text-center mb-12">
          {{ t('home.features.title') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div class="text-center space-y-3">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/20">
              <UIcon
                name="i-lucide-message-circle"
                class="w-6 h-6 text-primary"
              />
            </div>
            <h3 class="font-semibold text-lg">
              {{ t('home.features.aiConversations.title') }}
            </h3>
            <p class="text-sm text-muted-600 dark:text-muted-400">
              {{ t('home.features.aiConversations.description') }}
            </p>
          </div>
          <div class="text-center space-y-3">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/20">
              <UIcon
                name="i-lucide-file-text"
                class="w-6 h-6 text-primary"
              />
            </div>
            <h3 class="font-semibold text-lg">
              {{ t('home.features.contentManagement.title') }}
            </h3>
            <p class="text-sm text-muted-600 dark:text-muted-400">
              {{ t('home.features.contentManagement.description') }}
            </p>
          </div>
          <div class="text-center space-y-3">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/20">
              <UIcon
                name="i-lucide-zap"
                class="w-6 h-6 text-primary"
              />
            </div>
            <h3 class="font-semibold text-lg">
              {{ t('home.features.fastEfficient.title') }}
            </h3>
            <p class="text-sm text-muted-600 dark:text-muted-400">
              {{ t('home.features.fastEfficient.description') }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
