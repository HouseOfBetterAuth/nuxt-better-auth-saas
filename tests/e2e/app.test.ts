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
    const h1 = await page.$('h1')
    expect(await h1?.textContent()).eq('NuxSaaS')
  })
})
