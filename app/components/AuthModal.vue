<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import signInI18n from '~/pages/signin/i18n.json'
import signUpI18n from '~/pages/signup/i18n.json'

type Mode = 'signin' | 'signup'

const props = defineProps<{
  open: boolean
  mode?: Mode
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:mode': [value: Mode]
}>()

const { t } = useI18n(({
  useScope: 'local',
  messages: {
    'en': {
      ...((signInI18n as any).en || {}),
      ...((signUpI18n as any).en || {})
    },
    'zh-CN': {
      ...((signInI18n as any)['zh-CN'] || {}),
      ...((signUpI18n as any)['zh-CN'] || {})
    },
    'ja': {
      ...((signInI18n as any).ja || {}),
      ...((signUpI18n as any).ja || {})
    },
    'fr': {
      ...((signInI18n as any).fr || {}),
      ...((signUpI18n as any).fr || {})
    }
  }
} as any))
const auth = useAuth()
const toast = useToast()
const route = useRoute()
const localePath = useLocalePath()

const currentMode = computed<Mode>(() => props.mode ?? 'signin')

function setMode(mode: Mode) {
  emit('update:mode', mode)
}

const redirectTo = computed(() => {
  const redirect = route.query.redirect as string
  return localePath(redirect || '/')
})

// ---------- Sign in form ----------
const signInSchema = z.object({
  email: z.email(t('signIn.errors.invalidEmail')),
  password: z.string().min(8, t('signIn.errors.passwordLength', { min: 8 })),
  rememberMe: z.boolean().optional()
})

type SignInSchema = zodOutput<typeof signInSchema>

const signInState = reactive<Partial<SignInSchema>>({
  email: undefined,
  password: undefined,
  rememberMe: false
})

const loading = ref(false)
const loadingAction = ref('')

const isEmailVerifyModalOpen = ref(false)
const resendLoading = ref(false)
let unverifiedEmail = ''

async function onSignInSocialLogin(action: 'google' | 'github') {
  loading.value = true
  loadingAction.value = action
  auth.signIn.social({ provider: action, callbackURL: redirectTo.value })
}

async function onSignInSubmit(event: FormSubmitEvent<SignInSchema>) {
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
      emit('update:open', false)
      // Always navigate after a successful sign-in to avoid getting stuck on the guest page
      await navigateTo(redirectTo.value)
    }
  } catch (err: any) {
    console.error('[auth-modal] Failed to sign in:', err)
    toast.add({
      title: err?.message || t('signIn.errors.generalError'),
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

// ---------- Sign up form ----------
const referralCode = useStorage('referralCode', '')

watchEffect(() => {
  const refParam = route.query.ref as string
  if (refParam) {
    referralCode.value = refParam
  }
})

const signUpSchema = z.object({
  name: z.string().min(5, t('signUp.form.name.error', { min: 5 })),
  email: z.email(t('signUp.form.email.error')),
  password: z.string().min(8, t('signUp.form.password.error', { min: 8 })),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: t('signUp.form.confirmPassword.error'),
  path: ['confirmPassword']
})

type SignUpSchema = zodOutput<typeof signUpSchema>

const signUpState = reactive<Partial<SignUpSchema>>({
  name: undefined,
  email: undefined,
  password: undefined,
  confirmPassword: undefined
})

async function onSignUpSocialLogin(action: 'google' | 'github') {
  loading.value = true
  loadingAction.value = action

  auth.signIn.social({
    provider: action,
    callbackURL: redirectTo.value,
    additionalData: referralCode.value ? { referralCode: referralCode.value } : undefined
  })
}

async function onSignUpSubmit(event: FormSubmitEvent<SignUpSchema>) {
  if (loading.value)
    return

  loading.value = true
  loadingAction.value = 'submit'

  const { error } = await auth.signUp.email({
    name: event.data.name,
    email: event.data.email,
    password: event.data.password,
    referralCode: referralCode.value || undefined
  })

  if (error) {
    toast.add({
      title: error.message || (error as any).statusText,
      color: 'error'
    })
  } else {
    toast.add({
      title: t('signUp.sendEmailSuccess'),
      color: 'success'
    })

    signUpState.name = undefined
    signUpState.email = undefined
    signUpState.password = undefined
    signUpState.confirmPassword = undefined

    setMode('signin')
  }

  loading.value = false
  loadingAction.value = ''
}
</script>

<template>
  <UModal
    :open="open"
    :title="currentMode === 'signin' ? t('signIn.title') : t('signUp.pageTitle')"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <UCard>
        <template #header>
          <div class="text-center p-4">
            <h1 class="text-xl font-semibold">
              <template v-if="currentMode === 'signin'">
                {{ t('signIn.welcome', { name: t('global.appName') }) }}
              </template>
              <template v-else>
                {{ t('signUp.title') }}
              </template>
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
              @click="currentMode === 'signin' ? onSignInSocialLogin('google') : onSignUpSocialLogin('google')"
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
              @click="currentMode === 'signin' ? onSignInSocialLogin('github') : onSignUpSocialLogin('github')"
            >
              Github
            </UButton>
          </div>

          <USeparator :label="currentMode === 'signin' ? t('signIn.or') : t('signUp.or')" />

          <UForm
            v-if="currentMode === 'signin'"
            :schema="signInSchema"
            :state="signInState"
            class="space-y-4"
            @submit="onSignInSubmit"
          >
            <UFormField
              :label="t('signIn.email')"
              name="email"
              required
            >
              <UInput
                v-model="signInState.email"
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
                v-model="signInState.password"
                type="password"
                class="w-full"
                :placeholder="t('signIn.passwordPlaceholder')"
              />
            </UFormField>

            <div class="flex flex-col items-start justify-between gap-2">
              <UFormField name="rememberMe">
                <UCheckbox
                  v-model="signInState.rememberMe"
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
                @click="setMode('signup')"
              >
                {{ t('signIn.createAccount') }}
              </UButton>
            </div>
          </UForm>

          <UForm
            v-else
            :schema="signUpSchema"
            :state="signUpState"
            class="space-y-4"
            @submit="onSignUpSubmit"
          >
            <UFormField
              :label="t('signUp.form.name.label')"
              name="name"
              required
            >
              <UInput
                v-model="signUpState.name"
                :placeholder="t('signUp.form.name.placeholder')"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('signUp.form.email.label')"
              name="email"
              autocomplete="email"
              required
            >
              <UInput
                v-model="signUpState.email"
                type="email"
                :placeholder="t('signUp.form.email.placeholder')"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('signUp.form.password.label')"
              name="password"
              required
            >
              <UInput
                v-model="signUpState.password"
                type="password"
                :placeholder="t('signUp.form.password.placeholder')"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('signUp.form.confirmPassword.label')"
              name="confirmPassword"
              required
            >
              <UInput
                v-model="signUpState.confirmPassword"
                type="password"
                :placeholder="t('signUp.form.confirmPassword.placeholder')"
                class="w-full"
              />
            </UFormField>

            <UButton
              type="submit"
              color="primary"
              block
              :loading="loading && loadingAction === 'submit'"
              :disabled="loading"
            >
              {{ t('signUp.submit') }}
            </UButton>

            <div class="text-center text-sm">
              {{ t('signUp.haveAccount') }}
              <UButton
                variant="link"
                color="primary"
                :disabled="loading"
                @click="setMode('signin')"
              >
                {{ t('signUp.signIn') }}
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
    </template>
  </UModal>
</template>
