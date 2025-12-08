<i18n src="./index.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: false
})

const { t } = useI18n()

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
  <!-- Chat is now in layout, so this page just needs to exist for routing -->
  <div />
</template>
