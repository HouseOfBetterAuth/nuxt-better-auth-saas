import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  stripeSecretKey: '' as string | undefined,
  stripeWebhookSecret: '',
  public: {
    baseURL: 'https://saas.example.test'
  }
}))
const session = { user: { id: 'u1' } }
const db = vi.hoisted(() => ({
  query: {
    member: { findFirst: vi.fn(async () => ({ role: 'owner' })) },
    organization: { findFirst: vi.fn(async () => ({ id: 'org1', stripeCustomerId: 'cus_canary' })) },
    subscription: { findFirst: vi.fn(async () => null) }
  },
  update: vi.fn()
}))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('~~/server/utils/auth', () => ({ getAuthSession: vi.fn(async () => session) }))
vi.mock('~~/server/utils/db', () => ({ getDB: vi.fn(() => db), useDB: vi.fn(async () => db) }))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/stripeEmails', () => ({}))
vi.mock('~~/server/utils/subscription-handlers', () => ({ removeExcessMembersOnExpiration: vi.fn() }))

// Nitro auto-imports, unavailable outside Nuxt.
vi.stubGlobal('runtimeConfig', runtimeConfig)
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('readBody', async (event: { body: unknown }) => event.body)
vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input))

const routes = {
  'cancel': {
    load: () => import('~~/server/api/stripe/cancel.post'),
    body: { subscriptionId: 'sub_canary', referenceId: 'org1' }
  },
  'resume': {
    load: () => import('~~/server/api/stripe/resume.post'),
    body: { subscriptionId: 'sub_canary', referenceId: 'org1' }
  },
  'update-seats': {
    load: () => import('~~/server/api/stripe/update-seats.post'),
    body: { organizationId: 'org1', seats: 2 }
  }
}

describe('stripe routes without a secret key', () => {
  beforeEach(() => {
    runtimeConfig.stripeSecretKey = ''
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it.each(Object.entries(routes))('%s answers 503 Billing is not configured', async (_name, route) => {
    const handler = (await route.load()).default as unknown as (event: unknown) => Promise<unknown>

    await expect(handler({ body: route.body })).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Billing is not configured'
    })
  })
})
