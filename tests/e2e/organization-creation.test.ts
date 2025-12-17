import { createPage, setup } from '@nuxt/test-utils/e2e'
import { createEmailVerificationToken } from 'better-auth/api'
import { request as playwrightRequest } from 'playwright-core'
import { beforeAll, describe, expect, it } from 'vitest'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const bootstrapTestUser = async (
  host: string,
  email?: string,
  password?: string,
  secret?: string
) => {
  if (!email || !password || !secret) {
    console.warn('Skipping test user bootstrap because required environment variables are missing.')
    return
  }

  const normalizedEmail = email.toLowerCase()
  const context = await playwrightRequest.newContext({
    baseURL: host,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      Origin: host,
      Referer: `${host}/`
    }
  })

  try {
    const signUpResponse = await context.post('/api/auth/sign-up/email', {
      data: {
        email: normalizedEmail,
        password,
        name: normalizedEmail.split('@')[0],
        rememberMe: true
      }
    })
    const signUpStatus = signUpResponse.status()
    if (!signUpResponse.ok()) {
      const body = await signUpResponse.text()
      if (signUpStatus !== 422 || !body.includes('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')) {
        console.warn('Sign up response:', signUpStatus, body)
      }
    }

    await sleep(300)

    const token = await createEmailVerificationToken(secret, normalizedEmail)
    const verifyResponse = await context.get('/api/auth/verify-email', {
      params: { token }
    })

    if (!verifyResponse.ok()) {
      const text = await verifyResponse.text()
      console.warn('Email verification response:', verifyResponse.status(), text)
    } else {
      await sleep(300)
    }

    const signInResponse = await context.post('/api/auth/sign-in/email', {
      data: {
        email: normalizedEmail,
        password
      }
    })
    if (!signInResponse.ok()) {
      const text = await signInResponse.text()
      console.warn('Sign in bootstrap failed:', signInResponse.status(), text)
    } else {
      await context.post('/api/auth/sign-out', { data: {} }).catch(() => {})
    }
  } finally {
    await context.dispose()
  }
}

describe('organization creation after sign out/in', async () => {
  const host = process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'
  const testEmail = process.env.NUXT_TEST_EMAIL
  const testPassword = process.env.NUXT_TEST_PASSWORD
  const betterAuthSecret = process.env.NUXT_BETTER_AUTH_SECRET
  await setup({ host })
  beforeAll(async () => {
    await bootstrapTestUser(host, testEmail, testPassword, betterAuthSecret)
  }, 60000)

  it('should handle stale session and allow organization creation after re-authentication', async () => {
    const page = await createPage('/conversations')
    await page.waitForLoadState('networkidle')

    // Step 1: Sign out to clear any stale session
    console.log('Step 1: Signing out...')
    try {
      // Try to find and click sign out button
      const userMenu = await page.$('[data-testid="user-menu"], [aria-label="User menu"]')
      if (userMenu) {
        await userMenu.click()
        await page.waitForTimeout(500)

        // Look for sign out option in dropdown
        const signOutButton = await page.$('button:has-text("Sign Out"), a:has-text("Sign Out"), [role="menuitem"]:has-text("Sign Out")')
        if (signOutButton) {
          await signOutButton.click()
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(1000)
        }
      }
    } catch {
      console.log('Could not find sign out button, trying API sign out...')
      // Fallback: try API sign out
      await page.evaluate(async () => {
        await fetch('/api/auth/sign-out', {
          method: 'POST',
          credentials: 'include'
        })
      })
      await page.waitForTimeout(1000)
    }

    // Step 2: Sign in with valid credentials
    console.log('Step 2: Signing in...')
    if (!testEmail || !testPassword) {
      console.warn('Skipping test because NUXT_TEST_EMAIL and NUXT_TEST_PASSWORD are not set.')
      return
    }
    const email = testEmail
    const password = testPassword

    await page.goto(`${host}/signin`)
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('input[name="email"]', { timeout: 5000 })

    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')

    // Wait for sign in to complete by waiting for the user menu to appear
    await page.waitForSelector('[data-testid="user-menu"]', { timeout: 15000 })

    // Step 3: Navigate to conversations (should show onboarding if no org)
    console.log('Step 3: Checking for onboarding...')
    await page.goto(`${host}/conversations`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Step 4: Create organization via API
    console.log('Step 4: Creating organization...')
    const uniqueSlug = `test-org-${Date.now()}`
    const createResult = await page.evaluate(async (slug) => {
      const response = await fetch('/api/auth/organization/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          name: 'Test Organization',
          slug
        })
      })
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text.substring(0, 500) }
      }
      return {
        status: response.status,
        ok: response.ok,
        data
      }
    }, uniqueSlug)

    console.log('Organization creation result:', createResult)

    // Step 5: Verify organization was created successfully
    expect(createResult.ok).toBe(true)
    expect(createResult.status).toBe(200)
    expect(createResult.data?.id).toBeTruthy()
    expect(createResult.data?.name).toBe('Test Organization')
    expect(createResult.data?.slug).toBe(uniqueSlug)

    const orgId = createResult.data?.id
    expect(orgId).toBeTruthy()

    // Step 6: Set organization as active
    console.log('Step 6: Setting organization as active...')
    const setActiveResult = await page.evaluate(async (id) => {
      const response = await fetch('/api/auth/organization/set-active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          organizationId: id
        })
      })
      return {
        status: response.status,
        ok: response.ok
      }
    }, orgId)

    expect(setActiveResult.ok).toBe(true)

    // Step 7: Test organization list endpoint
    console.log('Step 7: Testing organization list endpoint...')
    const orgListResult = await page.evaluate(async (expectedId) => {
      const response = await fetch('/api/auth/organization/list', {
        credentials: 'include'
      })
      const data = await response.json()
      const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
      const org = items.find((item: any) => item.id === expectedId)
      return {
        status: response.status,
        ok: response.ok,
        items,
        org
      }
    }, orgId)

    expect(orgListResult.ok).toBe(true)
    expect(Array.isArray(orgListResult.items)).toBe(true)
    expect(orgListResult.items.length).toBeGreaterThan(0)
    expect(orgListResult.org).toBeTruthy()
    expect(orgListResult.org?.id).toBe(orgId)

    // Step 8: Test integrations endpoint
    console.log('Step 8: Testing integrations endpoint...')
    const integrationsResult = await page.evaluate(async () => {
      const response = await fetch('/api/organization/integrations', {
        credentials: 'include'
      })
      const data = await response.json()
      return {
        status: response.status,
        ok: response.ok,
        hasData: !!data
      }
    })

    expect(integrationsResult.ok).toBe(true)
    expect(integrationsResult.status).toBe(200)

    // Step 9: Invite another user as a regular org member and ensure they cannot read tokens
    console.log('Step 9: Verifying integrations are restricted to owner/admin...')
    if (!betterAuthSecret) {
      throw new Error('NUXT_BETTER_AUTH_SECRET must be set for this test')
    }
    const invitedEmail = `member-${Date.now()}@example.com`
    const invitedPassword = `TestPass-${Date.now()}!`

    // Create + verify + sign in invited user in an isolated request context (separate cookies)
    const invitedContext = await playwrightRequest.newContext({
      baseURL: host,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        Origin: host,
        Referer: `${host}/`
      }
    })
    try {
      await invitedContext.post('/api/auth/sign-up/email', {
        data: {
          email: invitedEmail,
          password: invitedPassword,
          name: invitedEmail.split('@')[0],
          rememberMe: true
        }
      })

      await sleep(300)

      const invitedVerifyToken = await createEmailVerificationToken(betterAuthSecret, invitedEmail)
      await invitedContext.get('/api/auth/verify-email', { params: { token: invitedVerifyToken } })

      await sleep(300)

      const invitedSignIn = await invitedContext.post('/api/auth/sign-in/email', {
        data: { email: invitedEmail, password: invitedPassword }
      })
      expect(invitedSignIn.ok()).toBe(true)

      // Owner invites the invited user as "member"
      const inviteResult = await page.evaluate(async (email) => {
        const response = await fetch('/api/auth/organization/invite-member', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            email,
            role: 'member'
          })
        })
        const text = await response.text()
        let data: any
        try {
          data = JSON.parse(text)
        } catch {
          data = { raw: text.substring(0, 500) }
        }
        return {
          status: response.status,
          ok: response.ok,
          data
        }
      }, invitedEmail)

      expect(inviteResult.ok).toBe(true)
      const invitationId = inviteResult.data?.id
        || inviteResult.data?.invitation?.id
        || inviteResult.data?.data?.id
        || inviteResult.data?.data?.invitation?.id
      expect(invitationId).toBeTruthy()

      // Invited user accepts the invitation and sets org active
      const acceptRes = await invitedContext.post('/api/auth/organization/accept-invitation', {
        data: { invitationId }
      })
      expect(acceptRes.ok()).toBe(true)

      const setActiveInvited = await invitedContext.post('/api/auth/organization/set-active', {
        data: { organizationId: orgId }
      })
      expect(setActiveInvited.ok()).toBe(true)

      // Invited (member) user should be forbidden from reading integrations (token-bearing response)
      const forbiddenIntegrations = await invitedContext.get('/api/organization/integrations')
      expect(forbiddenIntegrations.status()).toBe(403)
    } finally {
      await invitedContext.dispose()
    }

    console.log('✅ All tests passed! Organization creation works after re-authentication.')
  }, 60000)
})
