<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: t('global.legal.privacyPolicy')
})
</script>

<template>
  <div class="min-h-screen py-12 px-4">
    <div class="max-w-3xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">
        {{ t('global.legal.privacyPolicy') }}
      </h1>

      <div class="prose dark:prose-invert max-w-none">
        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Privacy Policy
          </h2>
          <p class="text-muted-foreground mb-4">
            Last updated: January 1, 2025
          </p>
          <p class="mb-4">
            This Privacy Policy describes how we collect, use, and protect your personal information when you use our service.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Information We Collect
          </h2>
          <p class="mb-4">
            We collect information that you provide directly to us, such as when you create an account, use our services, or contact us for support.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            How We Use Your Information
          </h2>
          <p class="mb-4">
            We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Data Security
          </h2>
          <p class="mb-4">
            We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Your Rights
          </h2>
          <p class="mb-4">
            You have the right to access, update, or delete your personal information at any time. Please contact us if you wish to exercise these rights.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-2xl font-semibold mb-4">
            Contact Us
          </h2>
          <p class="mb-4">
            If you have any questions about this Privacy Policy, please contact us.
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
