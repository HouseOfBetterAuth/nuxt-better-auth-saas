import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('auth', async () => {
  const host = process.env.NUXT_TEST_APP_URL
  await setup({
    host
  })

  describe('guest routes', () => {
    it('should allow guest access to signin page', async () => {
      const page = await createPage('/signin')
      const signinButton = await page.$('button:has-text("Sign In")')
      expect(signinButton).toBeTruthy()
    })

    it('should redirect authenticated user away from signin page', async () => {
      const page = await createPage('/signin')
      await page.fill('input[name="email"]', process.env.NUXT_TEST_EMAIL!)
      await page.fill('input[name="password"]', process.env.NUXT_TEST_PASSWORD!)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle')
      expect(page.url()).toEqual(`${host}/`)

      // // Try accessing signin page while logged in
      await page.goto(`${host}/signin`)
      await page.waitForLoadState('networkidle')
      expect(page.url()).toEqual(`${host}/`)
    })
  })

  describe('auth disabled routes', () => {
    it('should allow guest access to pricing page', async () => {
      const page = await createPage('/pricing')
      await page.waitForLoadState('networkidle')
      expect(page.url()).toEqual(`${host}/pricing`)
      const salesButton = await page.$('a:has-text("Contact Sales")')
      expect(salesButton).toBeTruthy()
    })

    it('should allow user access to pricing page', async () => {
      const page = await createPage('/signin')
      await page.fill('input[name="email"]', process.env.NUXT_TEST_EMAIL!)
      await page.fill('input[name="password"]', process.env.NUXT_TEST_PASSWORD!)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle')
      expect(page.url()).toEqual(`${host}/`)

      // // Try accessing signin page while logged in
      await page.goto(`${host}/pricing`)
      await page.waitForLoadState('networkidle')
      expect(page.url()).toEqual(`${host}/pricing`)
      const salesButton = await page.$('a:has-text("Contact Sales")')
      expect(salesButton).toBeTruthy() })
  })

  describe('guest should not access auth only pages.', () => {
    it('should redirect unauthenticated user to signin when accessing profile', async () => {
      const page = await createPage('/profile')
      await page.waitForLoadState('networkidle')
      expect(page.url()).toContain('/signin')
      expect(page.url()).toContain('redirect=/profile')
    })

    it('should redirect unauthenticated user to signin when accessing admin', async () => {
      const page = await createPage('/admin')
      await page.waitForLoadState('networkidle')
      expect(page.url()).toContain('/signin')
      expect(page.url()).toContain('redirect=/admin')
    })

    it('should redirect to localized signin with correct redirect parameter', async () => {
      const page = await createPage('/fr/admin')
      await page.waitForLoadState('networkidle')

      expect(page.url()).toContain('/fr/signin')
      expect(page.url()).toContain('redirect=/fr/admin')
    })
  })

  describe('admin users can access admin pages', () => {
    it('authenticated user can access profile page', async () => {
      // Login as regular user
      const page = await createPage('/signin')
      await page.fill('input[name="email"]', process.env.NUXT_TEST_EMAIL!)
      await page.fill('input[name="password"]', process.env.NUXT_TEST_PASSWORD!)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle')

      // Try accessing profile page
      await page.goto(`${host}/profile`)
      await page.waitForLoadState('networkidle')
      expect(page.url()).toContain('/profile')
    })

    it('should redirect non-admin user to 403', async () => {
      // Login as regular user
      const page = await createPage('/signin')
      await page.fill('input[name="email"]', process.env.NUXT_TEST_EMAIL!)
      await page.fill('input[name="password"]', process.env.NUXT_TEST_PASSWORD!)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle')

      // Try accessing admin page
      await page.goto(`${host}/admin`)
      await page.waitForLoadState('networkidle')
      expect(page.url()).toContain('/403')
    })

    it('admin user can access admin dashboard', async () => {
      // Login as admin
      const page = await createPage('/signin')
      await page.fill('input[name="email"]', process.env.NUXT_ADMIN_EMAIL!)
      await page.fill('input[name="password"]', process.env.NUXT_ADMIN_PASSWORD!)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle')

      // Access admin page
      await page.goto(`${host}/admin`)
      await page.waitForLoadState('networkidle')
      expect(page.url()).toContain('/admin/dashboard')
    })
  })
})
