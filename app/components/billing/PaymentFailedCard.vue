<script setup lang="ts">
/**
 * Payment failed action card
 * Shows detailed instructions and buttons to fix payment
 *
 * Usage: <BillingPaymentFailedCard />
 */
const { supportEmail } = defineProps<{
  supportEmail?: string
}>()

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
    class="mt-6 pt-6 border-t border-red-200 dark:border-red-800"
  >
    <div class="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
        Action Required: Update Payment Method
      </h3>
      <p class="text-sm text-red-700 dark:text-red-300 mb-4">
        Your last payment failed. To keep your Pro subscription active and retain your team members,
        please update your payment method. Once updated, we'll automatically retry the payment.
      </p>
      <div class="flex flex-col gap-3">
        <UButton
          color="red"
          icon="i-lucide-credit-card"
          :loading="loading"
          @click="openBillingPortal"
        >
          Update Payment Method
        </UButton>
        <UButton
          v-if="supportEmail"
          variant="outline"
          color="red"
          icon="i-lucide-mail"
          as="a"
          :href="`mailto:${supportEmail}?subject=Payment%20Issue`"
        >
          Contact Support
        </UButton>
      </div>
    </div>
  </div>
</template>
