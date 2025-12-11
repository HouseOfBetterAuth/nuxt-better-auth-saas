<i18n src="./i18n.json"></i18n>

<script setup lang="ts">
definePageMeta({
  auth: {
    only: 'guest'
  }
})

const { t } = useI18n()

useHead({
  title: t('signIn.title')
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.(t('signIn.title'))
const auth = useAuth()
const toast = useToast()
const route = useRoute()
const localePath = useLocalePath()

const redirectTo = computed(() => {
  const redirect = route.query.redirect as string
  return localePath(redirect || '/')
})

const schema = z.object({
  email: z.email(t('signIn.errors.invalidEmail')),
  password: z.string().min(8, t('signIn.errors.passwordLength', { min: 8 })),
  rememberMe: z.boolean().optional()
})
type Schema = zodOutput<typeof schema>

const state = reactive<Partial<Schema>>({
  email: undefined,
  password: undefined,
  rememberMe: false
})

const loading = ref(false)
const loadingAction = ref('')
const isEmailVerifyModalOpen = ref(false)
const resendLoading = ref(false)
let unverifiedEmail = ''

async function onSocialLogin(action: 'google' | 'github') {
  loading.value = true
  loadingAction.value = action
  auth.signIn.social({ provider: action, callbackURL: redirectTo.value })
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (loading.value)
    return
  loading.value = true
  loadingAction.value = 'submit'

  try {
    const { error, data } = await auth.signIn.email({
      email: event.data.email,
      password: event.data.password,
      rememberMe: event.data.rememberMe,
      callbackURL: redirectTo.value
    })

    if (error) {
      if (error.code === auth.errorCodes.EMAIL_NOT_VERIFIED) {
        unverifiedEmail = event.data.email
        isEmailVerifyModalOpen.value = true
        return
      }
      toast.add({
        title: error.message,
        color: 'error'
      })
      return
    }

    if (data && !error) {
      await auth.fetchSession()
      await nextTick()
      // Always navigate after a successful sign-in to avoid getting stuck on the guest page
      await navigateTo(redirectTo.value)
    }
  } catch (err: any) {
    console.error('[signin] Failed to sign in:', err)
    toast.add({
      title: err?.message || t('signIn.errors.invalidEmail'),
      color: 'error'
    })
  } finally {
    loading.value = false
    loadingAction.value = ''
  }
}

async function handleResendEmail() {
  if (resendLoading.value)
    return
  resendLoading.value = true
  const { error } = await auth.sendVerificationEmail({
    email: unverifiedEmail,
    callbackURL: redirectTo.value
  })
  if (error) {
    toast.add({
      title: error.message,
      color: 'error'
    })
  } else {
    toast.add({
      title: t('signIn.sendEmailSuccess'),
      color: 'success'
    })
  }

  isEmailVerifyModalOpen.value = false
  resendLoading.value = false
}
</script>

<template>
  <UContainer class="flex items-center justify-center">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center p-4">
          <h1 class="text-xl font-semibold">
            {{ t('signIn.welcome', { name: t('global.appName') }) }}
          </h1>
        </div>
      </template>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-simple-icons-google"
            class="justify-center"
            :loading="loading && loadingAction === 'google'"
            :disabled="loading"
            @click="onSocialLogin('google')"
          >
            Google
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-simple-icons-github"
            class="justify-center"
            :loading="loading && loadingAction === 'github'"
            :disabled="loading"
            @click="onSocialLogin('github')"
          >
            Github
          </UButton>
        </div>

        <USeparator :label="t('signIn.or')" />

        <UForm
          :schema="schema"
          :state="state"
          class="space-y-4"
          @submit="onSubmit"
        >
          <UFormField
            :label="t('signIn.email')"
            name="email"
            required
          >
            <UInput
              v-model="state.email"
              type="email"
              class="w-full"
              :placeholder="t('signIn.emailPlaceholder')"
              autocomplete="email"
            />
          </UFormField>

          <UFormField
            :label="t('signIn.password')"
            name="password"
            required
          >
            <UInput
              v-model="state.password"
              type="password"
              class="w-full"
              :placeholder="t('signIn.passwordPlaceholder')"
            />
          </UFormField>

          <div class="flex flex-col items-start justify-between gap-2">
            <UFormField name="rememberMe">
              <UCheckbox
                v-model="state.rememberMe"
                :label="t('signIn.rememberMe')"
              />
            </UFormField>
            <UButton
              variant="link"
              color="neutral"
              :to="localePath('/forgot-password')"
            >
              {{ t('signIn.forgotPassword') }}
            </UButton>
          </div>

          <UButton
            type="submit"
            color="primary"
            block
            :disabled="loading"
            :loading="loading && loadingAction === 'submit'"
          >
            {{ t('signIn.signIn') }}
          </UButton>

          <div class="text-center text-sm">
            {{ t('signIn.noAccount') }}
            <UButton
              variant="link"
              color="primary"
              :disabled="loading"
              :to="localePath({ path: '/signup', query: route.query })"
            >
              {{ t('signIn.createAccount') }}
            </UButton>
          </div>
        </UForm>
      </div>
    </UCard>

    <UModal v-model:open="isEmailVerifyModalOpen">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items">
              <h3 class="text-lg font-medium">
                {{ t('signIn.emailNotVerified') }}
              </h3>
            </div>
          </template>

          <p class="text-sm">
            {{ t('signIn.emailNotVerifiedDesc') }}
          </p>

          <template #footer>
            <div class="flex justify-end gap-3">
              <UButton
                color="neutral"
                variant="outline"
                @click="isEmailVerifyModalOpen = false"
              >
                {{ t('global.page.cancel') }}
              </UButton>
              <UButton
                color="primary"
                :loading="resendLoading"
                @click="handleResendEmail"
              >
                {{ t('signIn.sendEmail') }}
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>
