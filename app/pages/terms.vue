<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: t('global.legal.terms')
})
</script>

<template>
  <div class="min-h-screen py-12 px-4">
    <div class="max-w-3xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">
        {{ t('global.legal.terms') }}
      </h1>

      <div class="prose dark:prose-invert max-w-none">
        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Terms of Service
          </h2>
          <p class="text-muted-foreground mb-4">
            Last updated: {{ new Date().toLocaleDateString() }}
          </p>
          <p class="mb-4">
            Please read these Terms of Service carefully before using our service.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Acceptance of Terms
          </h2>
          <p class="mb-4">
            By accessing and using this service, you accept and agree to be bound by the terms and provision of this agreement.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Use License
          </h2>
          <p class="mb-4">
            Permission is granted to temporarily use this service for personal, non-commercial transitory viewing only.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Disclaimer
          </h2>
          <p class="mb-4">
            The materials on this service are provided on an 'as is' basis. We make no warranties, expressed or implied, and hereby disclaim and negate all other warranties.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Contact Information
          </h2>
          <p class="mb-4">
            If you have any questions about these Terms of Service, please contact us.
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
