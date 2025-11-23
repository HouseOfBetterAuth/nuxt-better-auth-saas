<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const { items, filterName } = defineProps<{
  items: FilterItem[]
  name: string
  filterName: string
}>()

const emit = defineEmits<{
  (e: 'update:filter', value: string): void
}>()

const filter = defineModel<string>('filter', { default: '' })
const filterIndex = ref<string | undefined>(undefined)
const filterValueDict = computed(() => {
  const valueDict: Record<string, string> = {}
  items.forEach((item, index) => {
    valueDict[`key_${index}`] = item.id
    valueDict[`value_${item.id}`] = `${index}`
  })
  return valueDict
})

const route = useRoute()
const router = useRouter()

// Initialize filter from route query
if (route.query[filterName]) {
  const index = filterValueDict.value[`value_${route.query[filterName]}`] || undefined
  if (index != undefined) {
    filter.value = route.query[filterName] as string
    filterIndex.value = index
  }
}

// Watch for changes in filter and update the route query
watch(
  () => filterIndex.value,
  (newFilterIndex) => {
    const query = { ...route.query }
    const newFilter = filterValueDict.value[`key_${newFilterIndex}`] || ''
    if (newFilter) {
      query[filterName] = newFilter
      filter.value = newFilter
    } else {
      delete query[filterName]
      filter.value = ''
    }
    router.replace({ query })
    emit('update:filter', newFilter)
  },
  { deep: true }
)
</script>

<template>
  <UTabs
    v-model="filterIndex"
    variant="link"
    :items="items"
    :ui="{
      root: 'gap-0',
      list: 'bg-elevated rounded-lg p-0 border-0',
      trigger: 'data-[state=active]:text-(--ui-bg) data-[state=active]:bg-primary pl-4 pr-4',
      indicator: 'hidden'
    }"
  >
    <template #trailing="{ item }">
      <UBadge
        v-if="item.count != undefined && item.count > 0"
        color="neutral"
        variant="outline"
        size="sm"
      >
        {{ item.count }}
      </UBadge>
    </template>
  </UTabs>
</template>
