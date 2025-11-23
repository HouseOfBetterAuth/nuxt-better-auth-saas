<i18n src="./i18n.json"></i18n>

<script setup lang="ts" generic="T">
import SortableContent from './SortableContent.vue'

const { columns } = defineProps<{
  columns: AdminTableColumn<T>[]
}>()

const sortOptions = defineModel<SortOption[]>('sortOptions', { default: [] })

const { t } = useI18n()
</script>

<template>
  <UPopover
    arrow
    :content="{ align: 'end', side: 'bottom' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="lucide-arrow-down-up"
    >
      {{ sortOptions.length ? t('sortControl.sort') : '' }}
      <UBadge
        v-if="sortOptions.length"
        color="neutral"
        variant="outline"
        size="sm"
      >
        {{ sortOptions.length }}
      </UBadge>
    </UButton>
    <template #content>
      <SortableContent
        v-model:sort-options="sortOptions"
        :columns="columns"
        :t="t"
      />
    </template>
  </UPopover>
</template>
