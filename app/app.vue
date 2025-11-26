<script lang="ts" setup>
import { registerTheme } from 'echarts/core'
// Credit: https://github.com/nuxt/ui/issues/978#issuecomment-3025809129
import NuxtUITheme from './assets/echarts-theme.json'

const { t } = useI18n()

// Zod locale configuration
const { locale } = useI18n()

registerTheme('nuxtui-chart', NuxtUITheme)
provide(THEME_KEY, 'nuxtui-chart')

const updateZodLocale = (newLocale: string) => {
  const localeKey = newLocale.replace('-', '') as keyof typeof zodLocales
  if (z.locales[localeKey]) {
    z.config(z.locales[localeKey]())
  } else {
    console.warn(`Zod locale "${localeKey}" not found, falling back to English.`)
    z.config(z.locales.en())
  }
}

const { session, user, client } = useAuth()
const isImpersonating = computed(() => !!(session.value as any)?.impersonatedBy)
const stoppingImpersonation = ref(false)

const stopImpersonating = async () => {
  stoppingImpersonation.value = true
  try {
    await client.admin.stopImpersonating()
    window.location.href = '/admin/user'
  } catch (e) {
    console.error(e)
    stoppingImpersonation.value = false
  }
}

watchEffect(() => {
  updateZodLocale(locale.value)
})

useHead({
  titleTemplate: (title) => {
    if (title) {
      if (title.includes(t('global.appName'))) {
        return title
      } else {
        return `${title} | ${t('global.appName')}`
      }
    } else {
      return t('global.appName')
    }
  }
})
useSeoMeta({
  ogSiteName: t('global.appName')
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <div
      v-if="isImpersonating"
      class="bg-amber-500 text-white px-6 py-3 flex justify-between items-center gap-4 fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full shadow-lg z-[100]"
    >
      <span class="font-medium whitespace-nowrap">
        Impersonating {{ user?.email }}
      </span>
      <UButton
        color="white"
        variant="solid"
        size="xs"
        :loading="stoppingImpersonation"
        class="rounded-full"
        @click="stopImpersonating"
      >
        Stop
      </UButton>
    </div>
  </UApp>
</template>
