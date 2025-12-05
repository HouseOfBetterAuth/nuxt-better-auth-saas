<i18n src="./index.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: false,
  layout: false
})

const { t } = useI18n()
const route = useRoute()
const layoutName = computed(() => (route.query.draft ? 'workspace' : 'default'))

const title = `${t('global.appName')}: ${t('home.slogan')}`
const desc = t('home.slogan')

useHead({
  title
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle')
if (setHeaderTitle) {
  setHeaderTitle(t('global.appName'))
}

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
    <ChatQuillioWidget />
  </NuxtLayout>
</template>
