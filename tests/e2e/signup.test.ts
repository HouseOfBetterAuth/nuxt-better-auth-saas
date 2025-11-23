import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('signup', async () => {
  await setup({ host: process.env.NUXT_TEST_APP_URL })

  it('should show signup form', async () => {
    const page = await createPage('/signup')
    const title = await page.$('h1')
    expect(await title?.textContent()).toContain('Create your account')
  })

  it('should validate form fields', async () => {
    const page = await createPage('/signup')
    await page.fill('input[name="name"]', 'te')
    await page.fill('input[name="email"]', 'invalid-email')
    await page.fill('input[name="password"]', '123')
    await page.fill('input[name="confirmPassword"]', '1234')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(4)
    expect(await errors[0]?.textContent()).toEqual('Name must be at least 5 characters')
    expect(await errors[1]?.textContent()).toEqual('Invalid email address')
    expect(await errors[2]?.textContent()).toEqual('Password must be at least 8 characters')
    expect(await errors[3]?.textContent()).toEqual('Passwords don\'t match')
  })

  it('should validate form fields in Français', async () => {
    const page = await createPage('/fr/signup')
    await page.fill('input[name="name"]', 'te')
    await page.fill('input[name="email"]', 'invalid-email')
    await page.fill('input[name="password"]', '123')
    await page.fill('input[name="confirmPassword"]', '1234')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(4)
    expect(await errors[0]?.textContent()).toEqual('Le nom doit contenir au moins 5 caractères')
    expect(await errors[1]?.textContent()).toEqual('Adresse email invalide')
    expect(await errors[2]?.textContent()).toEqual('Le mot de passe doit contenir au moins 8 caractères')
    expect(await errors[3]?.textContent()).toEqual('Les mots de passe ne correspondent pas')
  })

  it('should submit valid signup form', async () => {
    const page = await createPage('/signup')

    await page.fill('input[name="name"]', 'Test User')
    await page.fill('input[name="email"]', 'test@example.com')
    await page.fill('input[name="password"]', 'password123')
    await page.fill('input[name="confirmPassword"]', 'password123')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(0)
  })

  it('should have working social login buttons', async () => {
    const page = await createPage('/signup')

    const googleButton = await page.$('button:has-text("Google")')
    const githubButton = await page.$('button:has-text("Github")')

    expect(googleButton).toBeTruthy()
    expect(githubButton).toBeTruthy()
  })
})
