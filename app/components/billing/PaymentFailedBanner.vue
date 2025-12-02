<script setup lang="ts">
/**
 * Global payment failed warning banner
 * Shows at the top of dashboard pages when subscription is past_due
 *
 * Usage: <BillingPaymentFailedBanner />
 */
const { isPaymentFailed, organizationId } = usePaymentStatus()

const loading = ref(false)

async function openBillingPortal() {
  if (!organizationId.value)
    return
  loading.value = true
  try {
    const { url } = await $fetch('/api/stripe/portal', {
      method: 'POST',
      body: { organizationId: organizationId.value }
    })
    if (url) {
      window.location.href = url
    }
  } catch (e) {
    console.error('Failed to open billing portal:', e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    v-if="isPaymentFailed"
    class="mx-2 mt-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <UIcon
          name="i-lucide-alert-triangle"
          class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0"
        />
        <div>
          <span class="font-medium text-red-800 dark:text-red-200">Payment Failed</span>
          <span class="text-sm text-red-700 dark:text-red-300 ml-2">
            Update your payment method to avoid losing Pro access and team members.
          </span>
        </div>
      </div>
      <UButton
        label="Fix Now"
        color="red"
        size="xs"
        icon="i-lucide-credit-card"
        :loading="loading"
        @click="openBillingPortal"
      />
    </div>
  </div>
</template>
