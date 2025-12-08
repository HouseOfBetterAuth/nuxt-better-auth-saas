<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
const { t } = useI18n()

const stats = ref([
  {
    name: 'activeUsers',
    value: '2,834',
    change: '+12.5%',
    isIncrease: true,
    icon: 'users'
  },
  {
    name: 'totalRevenue',
    value: '$45,289',
    change: '+8.2%',
    isIncrease: true,
    icon: 'dollar-sign'
  },
  {
    name: 'activeProjects',
    value: '156',
    change: '-3.1%',
    isIncrease: false,
    icon: 'folder'
  },
  {
    name: 'customerSatisfaction',
    value: '94.8%',
    change: '+2.3%',
    isIncrease: true,
    icon: 'smile'
  }
])
</script>

<template>
  <NuxtLayout name="admin">
    <div class="space-y-8">
      <div class="grid grid-cols-1 gap-4">
        <UCard
          v-for="stat in stats"
          :key="stat.name"
          class="relative overflow-hidden"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm text-neutral-500 dark:text-neutral-400">
                {{ t(`dashboard.stats.${stat.name}`) }}
              </div>
              <div class="mt-1 text-2xl font-semibold">
                {{ stat.value }}
              </div>
              <div
                class="mt-2 flex items-center text-sm"
                :class="stat.isIncrease ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'"
              >
                <Icon
                  :name="stat.isIncrease ? 'lucide:trending-up' : 'lucide:trending-down'"
                  class="mr-1 h-4 w-4"
                />
                {{ stat.change }}
              </div>
            </div>
            <Icon
              :name="`lucide:${stat.icon}`"
              class="h-8 w-8 text-neutral-400 dark:text-neutral-600"
            />
          </div>
        </UCard>
      </div>
    </div>
  </NuxtLayout>
</template>
