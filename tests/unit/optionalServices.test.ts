import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  preset: 'cloudflare-module',
  databaseUrl: 'postgres://u:p@db:5432/app',
  betterAuthSecret: 'secret',
  resendApiKey: '' as string | undefined,
  stripeSecretKey: '' as string | undefined,
  stripeWebhookSecret: '',
  public: {
    baseURL: 'https://saas.example.test',
    appName: 'Acme',
    appNotifyEmail: 'notify@example.test',
    appEnv: 'production'
  }
}))
const betterAuth = vi.hoisted(() => vi.fn((options: any) => ({ options, api: {} })))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('better-auth', () => ({ betterAuth }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('~~/server/utils/db', () => ({ getDB: vi.fn(() => ({})), useDB: vi.fn(async () => ({})) }))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/email', () => ({
  renderDeleteAccount: vi.fn(async () => '<p>delete</p>'),
  renderResetPassword: vi.fn(async () => '<p>reset</p>'),
  renderTeamInvite: vi.fn(async () => '<p>invite</p>'),
  renderVerifyEmail: vi.fn(async () => '<p>verify</p>')
}))
vi.mock('~~/server/utils/stripeEmails', () => ({}))
vi.mock('~~/server/utils/subscription-handlers', () => ({ removeExcessMembersOnExpiration: vi.fn() }))

vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input))

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test' }

async function authOptions() {
  const { createBetterAuth } = await import('~~/server/utils/auth')
  createBetterAuth()
  return betterAuth.mock.calls.at(-1)![0] as any
}

async function stubResendSend(result: { data?: unknown, error?: { message: string } | null }) {
  const { getResendClient } = await import('~~/server/utils/drivers')
  const client = getResendClient()!
  return vi.spyOn(client.emails, 'send').mockResolvedValue(result as any)
}

describe('optional services', () => {
  let spies: ReturnType<typeof vi.spyOn>[]

  beforeEach(() => {
    vi.resetModules()
    betterAuth.mockClear()
    runtimeConfig.resendApiKey = ''
    runtimeConfig.stripeSecretKey = ''
    runtimeConfig.public.appEnv = 'production'
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map(level => vi.spyOn(console, level).mockImplementation(() => {}))
  })

  afterEach(() => {
    spies.forEach(spy => spy.mockRestore())
  })

  const loggedText = () => spies
    .flatMap(spy => spy.mock.calls.flat())
    .map(arg => (arg instanceof Error ? arg.stack : typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join('\n')

  describe('stripe', () => {
    it('sets up auth without the billing plugin when no secret key is configured', async () => {
      const options = await authOptions()

      expect(options.plugins.map((plugin: any) => plugin.id)).not.toContain('stripe')
    })

    it('keeps the billing plugin when a secret key is configured', async () => {
      runtimeConfig.stripeSecretKey = 'sk_test_canary'

      const options = await authOptions()

      expect(options.plugins.map((plugin: any) => plugin.id)).toContain('stripe')
    })

    it('answers 503 instead of crashing when a client is requested without a key', async () => {
      const { createStripeClient } = await import('~~/server/utils/stripe')

      expect(() => createStripeClient()).toThrow(expect.objectContaining({ statusCode: 503 }))
    })
  })

  describe('the delete-account email', () => {
    const sendDeleteAccountVerification = async () => {
      const options = await authOptions()
      return options.user.deleteUser.sendDeleteAccountVerification({ user, url: 'https://saas.example.test/delete?token=t' })
    }

    it('is sent from the app notification address', async () => {
      runtimeConfig.resendApiKey = 're_canary_key'
      const send = await stubResendSend({ data: { id: 'm1' }, error: null })

      await sendDeleteAccountVerification()

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Acme <notify@example.test>', to: user.email }))
    })

    it('fails when the provider rejects the message', async () => {
      runtimeConfig.resendApiKey = 're_canary_key'
      await stubResendSend({ error: { message: 'invalid from' } })

      await expect(sendDeleteAccountVerification()).rejects.toMatchObject({ statusCode: 500 })
      expect(loggedText()).toContain('invalid from')
    })
  })

  describe('the email verification hook', () => {
    const token = 'canary-verification-token'
    const url = `https://saas.example.test/api/auth/verify-email?token=${token}`

    const sendVerificationEmail = async () => {
      const options = await authOptions()
      await options.emailVerification.sendVerificationEmail({ user, url, token })
    }

    it('does not log the link in production when the mail is sent', async () => {
      runtimeConfig.resendApiKey = 're_canary_key'
      const send = await stubResendSend({ data: { id: 'm1' }, error: null })

      await sendVerificationEmail()

      expect(send).toHaveBeenCalled()
      expect(loggedText()).not.toContain(token)
    })

    it('does not log the link in production when the mail fails', async () => {
      runtimeConfig.resendApiKey = 're_canary_key'
      await stubResendSend({ error: { message: 'provider down' } })

      await sendVerificationEmail()

      const logged = loggedText()
      expect(logged).toContain('provider down')
      expect(logged).not.toContain(token)
    })

    it('does not log the link in production when Resend is not configured', async () => {
      await sendVerificationEmail()

      expect(loggedText()).not.toContain(token)
    })

    it('logs the link in development so sign-up works without Resend', async () => {
      runtimeConfig.public.appEnv = 'development'

      await sendVerificationEmail()

      expect(loggedText()).toContain(token)
    })
  })
})
