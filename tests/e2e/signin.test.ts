import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('signin', async () => {
  await setup({ host: process.env.NUXT_TEST_APP_URL })

  it('should show signin form', async () => {
    const page = await createPage('/signin')
    const title = await page.$('h1')
    expect(await title?.textContent()).toContain(`Welcome to ${process.env.NUXT_APP_NAME}`)
  })

  it('should validate form fields', async () => {
    const page = await createPage('/signin')
    await page.fill('input[name="email"]', 'invalid-email')
    await page.fill('input[name="password"]', '123')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(2)
    expect(await errors[0]?.textContent()).toEqual('Invalid email address')
    expect(await errors[1]?.textContent()).toEqual('Password must be at least 8 characters')
  })

  it('should validate form fields in Français', async () => {
    const page = await createPage('/fr/signin')
    await page.fill('input[name="email"]', 'invalid-email')
    await page.fill('input[name="password"]', '123')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(2)
    expect(await errors[0]?.textContent()).toEqual('Adresse e-mail invalide')
    expect(await errors[1]?.textContent()).toEqual('Le mot de passe doit contenir au moins 8 caractères')
  })

  it('should submit valid signup form', async () => {
    const page = await createPage('/signin')

    await page.fill('input[name="email"]', 'test@example.com')
    await page.fill('input[name="password"]', 'password123')

    await page.click('h1')

    const errors = await page.$$('[id^="v-"][id$="-error"]')
    expect(errors.length).toEqual(0)
  })

  it('should have working social login buttons', async () => {
    const page = await createPage('/signin')

    const googleButton = await page.$('button:has-text("Google")')
    const githubButton = await page.$('button:has-text("Github")')

    expect(googleButton).toBeTruthy()
    expect(githubButton).toBeTruthy()
  })
})
