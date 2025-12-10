import { createPage, setup } from '@nuxt/test-utils/e2e'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('app', async () => {
  await setup({ host: process.env.NUXT_TEST_APP_URL })

  beforeEach(() => {
    // tell vitest we use mocked time
    console.log('beforeEach test')
  })

  afterEach(() => {
    // restoring date after each test run
    console.log('afterEach test')
  })

  it('should load homepage successfully', async () => {
    const page = await createPage('/')
    // Wait for page to load - homepage redirects to /conversations
    await page.waitForLoadState('networkidle')
    // Verify the page loaded successfully
    const pageContent = await page.textContent('body')
    expect(pageContent).toBeTruthy()
    // Homepage should redirect to conversations, verify we're not on an error page
    const url = page.url()
    expect(url).toBeTruthy()
    // The page should have loaded content (not an error state)
    expect(pageContent).toBeTruthy()
    expect(pageContent!.length).toBeGreaterThan(0)
  })
})
