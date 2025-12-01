<i18n src="./index.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: false,
  layout: false
})

const { t } = useI18n()
const localePath = useLocalePath()
const runtimeConfig = useRuntimeConfig()
const { user } = useAuth()

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

const features = [
  {
    icon: 'i-lucide-credit-card',
    title: t('home.features.items.billing.title'),
    description: t('home.features.items.billing.description')
  },
  {
    icon: 'i-lucide-mail',
    title: t('home.features.items.emails.title'),
    description: t('home.features.items.emails.description')
  },
  {
    icon: 'i-lucide-users',
    title: t('home.features.items.teams.title'),
    description: t('home.features.items.teams.description')
  },
  {
    icon: 'i-lucide-shield-check',
    title: t('home.features.items.auth.title'),
    description: t('home.features.items.auth.description')
  },
  {
    icon: 'i-lucide-user-cog',
    title: t('home.features.items.admin.title'),
    description: t('home.features.items.admin.description')
  },
  {
    icon: 'i-lucide-zap',
    title: t('home.features.items.ssr.title'),
    description: t('home.features.items.ssr.description')
  },
  {
    icon: 'i-lucide-layers',
    title: t('home.features.items.stack.title'),
    description: t('home.features.items.stack.description')
  }
]

const screenshots = [
  {
    label: t('home.screenshots.dashboard'),
    key: 'dashboard',
    src: '/screenshots/dashboard.png'
  },
  {
    label: t('home.screenshots.users'),
    key: 'users',
    src: '/screenshots/users.webp'
  },
  {
    label: t('home.screenshots.subscription'),
    key: 'subscription',
    src: '/screenshots/subscription.png'
  },
  {
    label: t('home.screenshots.pricing'),
    key: 'pricing',
    src: '/screenshots/pricing.png'
  },
  {
    label: t('home.screenshots.signin'),
    key: 'signin',
    src: '/screenshots/signin.png'
  }
]
const activeScreenshot = ref('0')
</script>

<template>
  <NuxtLayout name="default">
    <template #nav-center>
      <SiteNavigation
        mode="desktop"
        class="hidden sm:flex"
      />
    </template>
    <template #nav-right>
      <div class="flex items-center gap-2">
        <UserNavigation />
        <SiteNavigation
          mode="mobile"
          class="flex sm:hidden"
        />
      </div>
    </template>
    <div class="pt-16">
      <div class="absolute inset-0 bg-gradient-to-b from-emerald-50 to-white dark:from-neutral-900 dark:to-neutral-800" />
      <div class="absolute inset-0">
        <div class="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 blur-3xl opacity-50" />
        <div class="absolute top-0 left-0 w-[500px] h-[500px] bg-teal-500/20 rounded-full blur-3xl -ml-32 -mt-32 opacity-30" />
      </div>
      <!-- Hero Section -->
      <section class="relative overflow-hidden">
        <UContainer class="relative py-24">
          <div class="text-center">
            <h1 class="text-4xl font-bold tracking-tight sm:text-7xl mb-6">
              {{ t('global.appName') }}
            </h1>
            <p class="text-lg text-neutral-600 dark:text-neutral-400 mb-8">
              {{ t('home.slogan') }}
            </p>
            <div class="flex gap-4 justify-center">
              <UButton
                v-if="!user"
                :to="localePath('/signin')"
                color="primary"
                size="lg"
              >
                {{ t('home.getStarted') }}
              </UButton>
              <UButton
                v-else
                :to="localePath('/dashboard')"
                color="primary"
                size="lg"
              >
                Dashboard
              </UButton>
              <UButton
                :to="runtimeConfig.public.appRepo"
                target="_blank"
                color="neutral"
                variant="outline"
                size="lg"
                icon="i-simple-icons-github"
              >
                {{ t('home.viewOnGithub') }}
              </UButton>
              <UButton
                :to="localePath('/chat')"
                color="neutral"
                variant="soft"
                size="lg"
              >
                {{ t('home.tryQuillioChat') }}
              </UButton>
            </div>
          </div>
        </UContainer>
      </section>

      <!-- Screenshots Section -->
      <section class="relative mt-20">
        <UContainer>
          <div class="text-center mb-4">
            <h2 class="text-3xl font-bold">
              {{ t('home.screenshots.title') }}
            </h2>
          </div>
          <UTabs
            :items="screenshots"
            class="w-full hidden sm:block"
          >
            <template #content="{ item }">
              <div class="rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 shadow-lg">
                <img
                  :src="item.src"
                  :alt="item.label"
                  class="w-full h-auto"
                  loading="lazy"
                >
              </div>
            </template>
          </UTabs>
          <UAccordion
            v-model="activeScreenshot"
            :items="screenshots"
            class="w-full block sm:hidden"
          >
            <template #content="{ item }">
              <div class="rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 shadow-lg">
                <img
                  :src="item.src"
                  :alt="item.label"
                  class="w-full h-auto"
                  loading="lazy"
                >
              </div>
            </template>
          </UAccordion>
        </UContainer>
      </section>

      <!-- Features Section -->
      <section
        id="features"
        class="relative py-24 bg-neutral-50/50 dark:bg-neutral-900/50"
      >
        <UContainer>
          <div class="text-center mb-12">
            <h2 class="text-3xl font-bold">
              {{ t('home.features.title') }}
            </h2>
          </div>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <UCard
              v-for="feature in features"
              :key="feature.title"
              class="bg-white/80 dark:bg-neutral-800/80 backdrop-blur border-0 shadow hover:shadow-lg transition-shadow duration-200"
            >
              <div class="flex gap-4 items-start p-2">
                <div class="shrink-0">
                  <div class="p-3 bg-primary-50 dark:bg-primary-900/50 rounded-lg">
                    <UIcon
                      :name="feature.icon"
                      class="text-primary-500 w-6 h-6"
                    />
                  </div>
                </div>
                <div>
                  <h4 class="font-semibold mb-2">
                    {{ feature.title }}
                  </h4>
                  <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    {{ feature.description }}
                  </p>
                </div>
              </div>
            </UCard>
          </div>
        </UContainer>
      </section>
    </div>
  </NuxtLayout>
</template>
