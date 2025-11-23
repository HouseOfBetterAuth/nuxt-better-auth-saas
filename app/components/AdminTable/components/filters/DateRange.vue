<script setup lang="ts">
import { CalendarDate } from '@internationalized/date'
import { useRoute, useRouter } from 'vue-router'

const { name, filterName } = defineProps<{
  name: string
  filterName: string
}>()

const dateRange = defineModel<DateRange>('dateRange', { default: {
  start: undefined,
  end: undefined
} })

const clearDateRange = () => {
  dateRange.value = {
    start: undefined,
    end: undefined
  }
}

const route = useRoute()
const router = useRouter()

if (route.query[filterName]) {
  const { start, end } = JSON.parse(route.query[filterName] as string)
  const starts = start.split('-').map((item: string) => Number(item))
  const ends = end.split('-').map((item: string) => Number(item))
  dateRange.value.start = new CalendarDate(starts[0], starts[1], starts[2])
  dateRange.value.end = new CalendarDate(ends[0], ends[1], ends[2])
}

watch(
  () => dateRange.value,
  (_) => {
    const query = { ...route.query }
    if (dateRange.value.start && dateRange.value.end) {
      const start = dateRange.value.start
      const end = dateRange.value.end
      query[filterName] = JSON.stringify({
        start: `${start.year}-${start.month}-${start.day}`,
        end: `${end.year}-${end.month}-${end.day}`
      })
    } else {
      delete query[filterName]
    }
    router.replace({ query })
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
        v-if="dateRange.start && dateRange.end"
        name="i-lucide-circle-x"
        class="w-4 h-4 mr-1"
        @click.stop="clearDateRange"
      />
      <UIcon
        v-if="!(dateRange.start && dateRange.end)"
        name="i-lucide-calendar"
        class="w-4 h-4 mr-1"
      />
      {{ name }}
      <UBadge
        v-if="dateRange.start && dateRange.end"
        color="neutral"
        variant="outline"
        size="sm"
        class="ml-1"
      >
        {{ dateRange.start }} - {{ dateRange.end }}
      </UBadge>
    </UButton>

    <template #content>
      <UCalendar
        v-model="dateRange"
        class="p-2"
        :number-of-months="2"
        range
      />
    </template>
  </UPopover>
</template>
