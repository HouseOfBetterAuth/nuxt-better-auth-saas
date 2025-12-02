<script setup lang="ts">
interface Invoice {
  id: string
  number?: string | null
  status?: string | null
  amount: number
  currency: string
  created: number
  periodStart: number
  periodEnd: number
  hostedInvoiceUrl?: string | null
  invoicePdf?: string | null
  description: string
}

const props = defineProps<{
  organizationId: string
}>()

const invoices = ref<Invoice[]>([])
const loading = ref(false)
const hasMore = ref(false)
const lastInvoiceId = ref<string | null>(null)
const initialLimit = 3
const loadMoreLimit = 10

async function fetchInvoices(loadMore = false) {
  if (!props.organizationId)
    return

  loading.value = true
  try {
    const params: Record<string, any> = {
      organizationId: props.organizationId,
      limit: loadMore ? loadMoreLimit : initialLimit
    }

    if (loadMore && lastInvoiceId.value) {
      params.startingAfter = lastInvoiceId.value
    }

    const response = await $fetch('/api/stripe/invoices', {
      query: params
    })

    if (loadMore) {
      invoices.value = [...invoices.value, ...response.invoices]
    } else {
      invoices.value = response.invoices
    }

    hasMore.value = response.hasMore

    if (response.invoices && response.invoices.length > 0) {
      lastInvoiceId.value = response.invoices[response.invoices.length - 1].id
    }
  } catch (e) {
    console.error('Failed to fetch invoices:', e)
  } finally {
    loading.value = false
  }
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString()
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100)
}

function getStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'paid':
      return 'success'
    case 'open':
      return 'warning'
    case 'draft':
      return 'neutral'
    case 'void':
    case 'uncollectible':
      return 'error'
    default:
      return 'neutral'
  }
}

// Refresh invoices (reset and fetch fresh)
function refresh() {
  invoices.value = []
  lastInvoiceId.value = null
  fetchInvoices()
}

// Expose refresh method for parent components
defineExpose({ refresh })

// Fetch on mount
onMounted(() => {
  fetchInvoices()
})

// Watch for organization changes
watch(() => props.organizationId, () => {
  refresh()
})
</script>

<template>
  <div class="space-y-4">
    <!-- Loading State -->
    <div
      v-if="loading && invoices.length === 0"
      class="flex justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin w-6 h-6 text-primary"
      />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!loading && invoices.length === 0"
      class="text-center py-8 text-muted-foreground"
    >
      <UIcon
        name="i-lucide-receipt"
        class="w-10 h-10 mx-auto mb-2 opacity-50"
      />
      <p>No invoices yet</p>
    </div>

    <!-- Invoice List -->
    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="invoice in invoices"
        :key="invoice.id"
        class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
      >
        <div class="flex items-center gap-3">
          <div class="p-2 bg-white dark:bg-gray-700 rounded-lg">
            <UIcon
              name="i-lucide-file-text"
              class="w-4 h-4 text-muted-foreground"
            />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">
                {{ invoice.number || `Invoice ${invoice.id.slice(-8)}` }}
              </span>
              <UBadge
                :color="getStatusColor(invoice.status)"
                size="xs"
                variant="subtle"
              >
                {{ invoice.status }}
              </UBadge>
            </div>
            <div class="text-xs text-muted-foreground">
              {{ formatDate(invoice.created) }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="font-semibold">
            {{ formatAmount(invoice.amount, invoice.currency) }}
          </span>
          <div class="flex gap-1">
            <UButton
              v-if="invoice.hostedInvoiceUrl"
              icon="i-lucide-external-link"
              size="xs"
              color="gray"
              variant="ghost"
              :to="invoice.hostedInvoiceUrl"
              target="_blank"
              title="View Invoice"
            />
            <UButton
              v-if="invoice.invoicePdf"
              icon="i-lucide-download"
              size="xs"
              color="gray"
              variant="ghost"
              :to="invoice.invoicePdf"
              target="_blank"
              title="Download PDF"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Load More Button -->
    <div
      v-if="hasMore"
      class="flex justify-center pt-2"
    >
      <UButton
        label="Show more invoices"
        variant="ghost"
        color="gray"
        size="sm"
        :loading="loading"
        @click="fetchInvoices(true)"
      />
    </div>
  </div>
</template>
