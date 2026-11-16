import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  public: { baseURL: 'https://saas.example.test' as string | undefined }
}))
const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())
const findOrganization = vi.hoisted(() => vi.fn())
const createPortalSession = vi.hoisted(() => vi.fn())
const body = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      member: { findFirst: findMember },
      organization: { findFirst: findOrganization }
    }
  })
}))
vi.mock('~~/server/utils/stripe', () => ({
  createStripeClient: () => ({ billingPortal: { sessions: { create: createPortalSession } } })
}))

// Nitro auto-imports these h3 helpers; stand in with the same shapes.
beforeAll(() => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', async () => body.current)
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input))
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const org = { id: 'org-1', slug: 'acme', stripeCustomerId: 'cus_acme' }
const defaultReturnUrl = 'https://saas.example.test/acme/billing'

async function callPortal(payload: Record<string, unknown>) {
  body.current = payload
  const { default: handler } = await import('~~/server/api/stripe/portal.post')
  return (handler as unknown as (event: unknown) => Promise<{ url: string }>)({})
}

function returnUrlSentToStripe() {
  expect(createPortalSession).toHaveBeenCalledTimes(1)
  return createPortalSession.mock.calls[0][0].return_url
}

describe('the billing portal endpoint', () => {
  beforeEach(() => {
    runtimeConfig.public.baseURL = 'https://saas.example.test'
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset().mockResolvedValue({ userId: 'u1', organizationId: 'org-1', role: 'member' })
    findOrganization.mockReset().mockResolvedValue(org)
    createPortalSession.mockReset().mockResolvedValue({ url: 'https://billing.stripe.test/session' })
  })

  it('refuses an anonymous request', async () => {
    getAuthSession.mockResolvedValue(null)

    await expect(callPortal({ organizationId: 'org-1' })).rejects.toMatchObject({ statusCode: 401 })
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('refuses a user who is not a member of the organization, without calling Stripe', async () => {
    findMember.mockResolvedValue(undefined)

    await expect(callPortal({ organizationId: 'org-1' })).rejects.toMatchObject({ statusCode: 403 })
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('opens a session on the organization\'s customer for a member', async () => {
    const result = await callPortal({ organizationId: 'org-1' })

    expect(result).toEqual({ url: 'https://billing.stripe.test/session' })
    expect(createPortalSession).toHaveBeenCalledWith({ customer: 'cus_acme', return_url: defaultReturnUrl })
  })

  it('falls back to localhost when no base URL is configured', async () => {
    runtimeConfig.public.baseURL = undefined

    await callPortal({ organizationId: 'org-1', returnUrl: 'https://evil.example/phish' })

    expect(returnUrlSentToStripe()).toBe('http://localhost:3000/acme/billing')
  })

  it.each([
    ['a foreign origin', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example/phish'],
    ['a backslash-relative URL', '/\\evil.example/phish'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a same-host URL on another scheme', 'http://saas.example.test/acme/billing'],
    ['a non-string value', { href: 'https://evil.example' }]
  ])('falls back to the default return URL for %s', async (_label, returnUrl) => {
    await callPortal({ organizationId: 'org-1', returnUrl })

    expect(returnUrlSentToStripe()).toBe(defaultReturnUrl)
  })

  it('keeps a same-origin return URL', async () => {
    await callPortal({ organizationId: 'org-1', returnUrl: 'https://saas.example.test/acme/settings?tab=billing' })

    expect(returnUrlSentToStripe()).toBe('https://saas.example.test/acme/settings?tab=billing')
  })

  it('resolves a relative return path against the base URL', async () => {
    await callPortal({ organizationId: 'org-1', returnUrl: '/acme/settings' })

    expect(returnUrlSentToStripe()).toBe('https://saas.example.test/acme/settings')
  })
})
