<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const { items, name, filterName } = defineProps<{
  items: FilterItem[]
  name: string
  filterName: string
}>()

const emit = defineEmits<{
  (e: 'update:filter', value: string[]): void
}>()
const { t } = useI18n()

const filter = defineModel<string[]>('filter', { default: [] })

const route = useRoute()
const router = useRouter()

// Initialize filter from route query
if (route.query[filterName]) {
  filter.value = JSON.parse(route.query[filterName] as string)
}

const selectedItems = computed(() => {
  return items.filter(item => filter.value.includes(item.id))
})

const onUpdateChecked = (checked: string | boolean, item: FilterItem) => {
  if (checked) {
    filter.value.push(item.id)
  } else {
    filter.value.splice(filter.value.indexOf(item.id), 1)
  }
}

// Watch for changes in filter and update the route query
watch(
  () => filter.value,
  (newFilter) => {
    const query = { ...route.query }
    if (newFilter.length) {
      query[filterName] = JSON.stringify(newFilter)
    } else {
      delete query[filterName]
    }
    router.replace({ query })
    emit('update:filter', newFilter)
  },
  { deep: true }
)
</script>

<template>
  <UPopover
    :content="{
      align: 'start',
      side: 'bottom'
    }"
  >
    <UButton
      color="neutral"
      variant="subtle"
    >
      <UIcon
        v-if="selectedItems.length"
        name="i-lucide-circle-x"
        class="w-4 h-4 mr-1"
        @click.stop="filter = []"
      />
      <UIcon
        v-if="!selectedItems.length"
        name="i-lucide-filter"
        class="w-4 h-4 mr-1"
      />
      {{ name }}
      <template v-if="selectedItems.length && selectedItems.length <= 2">
        <UBadge
          v-for="item in selectedItems"
          :key="item.id"
          color="neutral"
          variant="outline"
          size="sm"
          class="ml-1"
        >
          {{ item.label }}
        </UBadge>
      </template>
      <template v-if="selectedItems.length && selectedItems.length > 2">
        <UBadge
          color="neutral"
          variant="outline"
          size="sm"
          class="ml-1"
        >
          {{ t('checkboxFilter.nSelected', { n: selectedItems.length }) }}
        </UBadge>
      </template>
    </UButton>

    <template #content>
      <div class="flex flex-col p-2">
        <div
          v-for="item in items"
          :key="item.id"
          class="flex items-center"
        >
          <UCheckbox
            :key="item.id"
            :model-value="filter.includes(item.id)"
            :ui="{
              wrapper: 'flex-1'
            }"
            class="p-1 flex-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @update:model-value="(e) => onUpdateChecked(e, item)"
          >
            <template #label>
              <div class="flex items-center">
                <span class="flex-1">{{ item.label }}</span>
                <UBadge
                  v-if="item.count != undefined"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="ml-2"
                >
                  {{ item.count }}
                </UBadge>
              </div>
            </template>
          </UCheckbox>
        </div>
      </div>
    </template>
  </UPopover>
</template>
