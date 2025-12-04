<i18n src="./index.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: false,
  layout: false
})

const { t } = useI18n()
const route = useRoute()
const layoutName = computed(() => (route.query.draft ? 'workspace' : 'default'))
const isWorkspaceLayout = computed(() => Boolean(route.query.draft))

const title = `${t('global.appName')}: ${t('home.slogan')}`
const desc = t('home.slogan')

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
  <NuxtLayout :name="layoutName">
    <template
      v-if="!isWorkspaceLayout"
      #nav-center
    >
      <SiteNavigation
        mode="desktop"
        class="hidden sm:flex"
      />
    </template>
    <template
      v-if="!isWorkspaceLayout"
      #nav-right
    >
      <div class="flex items-center gap-2">
        <UserNavigation />
        <SiteNavigation
          mode="mobile"
          class="flex sm:hidden"
        />
      </div>
    </template>
    <div :class="isWorkspaceLayout ? '' : 'pt-16'">
      <!-- Chat Section -->
      <ChatQuillioWidget />
    </div>
  </NuxtLayout>
</template>
