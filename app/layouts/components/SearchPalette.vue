<script setup lang="ts">
const { t } = defineProps<{
  t: TranFunction
}>()
const router = useRouter()
const localePath = useLocalePath()
const collapsed = defineModel('collapsed', { default: false })

const groups = ref([
  {
    id: 'Routes',
    label: t('menu.navigation'),
    items: [
      {
        label: t('menu.dashboard'),
        icon: 'i-lucide-layout-dashboard',
        to: localePath('/admin/dashboard'),
        kbds: [
          'G',
          '1'
        ]
      },
      {
        label: t('menu.users'),
        icon: 'i-lucide-users',
        to: localePath('/admin/user'),
        kbds: [
          'G',
          '2'
        ]
      }
    ]
  }
])

const value = ref({})
const isOpen = ref(false)

defineShortcuts({
  shift_g: {
    usingInput: true,
    handler: () => {
      isOpen.value = !isOpen.value
    }
  },
  escape: {
    usingInput: true,
    handler: () => { isOpen.value = false }
  }
})

const onClosePalette = (value: boolean) => {
  if (!value) {
    isOpen.value = false
  }
}

function onSelectPalette(item: any) {
  if (item.onSelect) {
    item.onSelect()
  } else if (item.to) {
    if (typeof item.to === 'string' && (item.target === '_blank' || item.to.startsWith('http'))) {
      window.open(item.to, item.target || '_blank')
    } else {
      router.push(item.to)
    }
  }
  onClosePalette(false)
}
</script>

<template>
  <UModal v-model:open="isOpen">
    <UButton
      :class="{ 'w-full': !collapsed }"
      size="sm"
      icon="i-lucide-search"
      color="neutral"
      variant="outline"
      @click="isOpen = true"
    >
      <span
        v-if="!collapsed"
        class="w-full text-left"
      >
        {{ `${t('menu.search')}...` }}
      </span>
      <template
        v-if="!collapsed"
        #trailing
      >
        <UKbd value="shift" />
        <UKbd value="G" />
      </template>
    </UButton>
    <template #content>
      <UCommandPalette
        v-model="value"
        close
        :groups="groups"
        :placeholder="`${t('menu.search')}...`"
        class="flex-1"
        @update:open="onClosePalette"
        @update:model-value="onSelectPalette"
      />
    </template>
  </UModal>
</template>
