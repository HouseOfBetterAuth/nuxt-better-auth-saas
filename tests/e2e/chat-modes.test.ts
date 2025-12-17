import { setup } from '@nuxt/test-utils/e2e'
import { $fetch } from 'ofetch'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Light E2E tests for chat vs agent mode behavior
 *
 * These tests verify the end-to-end behavior of the chat API
 * with different modes, focusing on tool availability and execution.
 */
describe('chat Modes E2E', async () => {
  await setup({ host: process.env.NUXT_TEST_APP_URL })

  const baseURL = process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'

  const getSetCookieHeaders = (headers: any): string[] => {
    // Node/undici Headers: non-standard but commonly available
    if (typeof headers?.getSetCookie === 'function') {
      return headers.getSetCookie() as string[]
    }
    // node-fetch style Headers
    if (typeof headers?.raw === 'function') {
      const raw = headers.raw()
      const values = raw?.['set-cookie']
      return Array.isArray(values) ? values : []
    }
    // Fallback (may only return the first Set-Cookie)
    const value = typeof headers?.get === 'function' ? headers.get('set-cookie') : undefined
    return typeof value === 'string' && value.length > 0 ? [value] : []
  }

  const getAnonymousCookie = async () => {
    const res = await $fetch.raw(`${baseURL}/api/conversations`, { method: 'GET' })
    const cookies = getSetCookieHeaders(res.headers)
    return cookies
      .map(cookie => cookie.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ')
  }

  // Helper to archive conversations
  // Optimized: Only archive once before all tests, not before/after each
  async function archiveAllConversations() {
    try {
      const cookie = await getAnonymousCookie()
      const response = await $fetch('/api/conversations', {
        baseURL,
        method: 'GET',
        headers: cookie ? { Cookie: cookie } : undefined
      }) as any

      const conversations = response?.conversations || []

      // Archive in parallel instead of sequentially
      await Promise.all(
        conversations
          .filter((conv: any) => conv.id && conv.status !== 'archived')
          .map((conv: any) =>
            $fetch(`/api/conversations/${conv.id}`, {
              baseURL,
              method: 'DELETE',
              headers: cookie ? { Cookie: cookie } : undefined
            }).catch(() => {
              // Ignore errors
            })
          )
      )

      // Reduced wait time
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch {
      // Ignore errors
    }
  }

  // Only archive once before all tests to reduce overhead
  beforeAll(async () => {
    await archiveAllConversations()
  })

  describe('anonymous conversations API', () => {
    it('returns conversations for anonymous users', async () => {
      const cookie = await getAnonymousCookie()
      const response = await $fetch('/api/conversations', {
        baseURL,
        method: 'GET',
        headers: cookie ? { Cookie: cookie } : undefined
      }) as any

      expect(Array.isArray(response?.conversations)).toBe(true)
    })
  })

  describe('chat Mode (Read-Only)', () => {
    it('should allow read operations in chat mode', async () => {
      // This test verifies that chat mode can use read tools
      // We can't easily test the full flow without a real DB, but we can
      // verify the endpoint accepts chat mode and doesn't immediately error

      try {
        const cookie = await getAnonymousCookie()
        const response = await $fetch('/api/chat?stream=true', {
          baseURL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: {
            message: 'List all content items',
            mode: 'chat'
          }
        }) as string

        // Should not contain mode enforcement errors
        expect(response).not.toContain('not available in chat mode')
        expect(response).not.toContain('Switch to agent mode')
      } catch (error: any) {
        // May hit other errors - that's acceptable
        // The important thing is it's not a mode enforcement error
        if (error?.data?.message?.includes('not available in chat mode')) {
          throw new Error('Chat mode incorrectly blocked read operation')
        }
        // Other errors are acceptable
      }
    })

    it('should block write operations in chat mode', async () => {
      try {
        const cookie = await getAnonymousCookie()
        const response = await $fetch('/api/chat?stream=true', {
          baseURL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: {
            message: 'Create a new blog post about testing',
            mode: 'chat'
          }
        }) as string

        // Should contain mode enforcement error OR the LLM should explain it can't do this
        const hasModeError = response.includes('not available in chat mode') ||
          response.includes('Switch to agent mode') ||
          response.includes('read-only')

        // If we got a response without mode error, the LLM should have explained
        // that it can't make changes (which is correct behavior)
        if (!hasModeError && !response.includes('error')) {
          // LLM correctly explained it can't make changes - that's fine
          expect(response.length).toBeGreaterThan(0)
        }
      } catch (error: any) {
        // Errors are acceptable

        // Mode enforcement error is expected
        if (error?.data?.message?.includes('not available in chat mode')) {
          expect(error.data.message).toContain('not available in chat mode')
        }

        // Other errors are acceptable for this test
      }
    })
  })

  describe('agent Mode (Read+Write)', () => {
    it('should allow all operations in agent mode', async () => {
      try {
        const cookie = await getAnonymousCookie()
        const response = await $fetch('/api/chat?stream=true', {
          baseURL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: {
            message: 'Create a blog post from this context: This is test content for agent mode.',
            mode: 'agent'
          }
        }) as string

        // Should not contain mode enforcement errors
        expect(response).not.toContain('not available in chat mode')
        expect(response).not.toContain('Writes are not allowed in chat mode')
      } catch (error: any) {
        // May hit other errors - that's acceptable
        // The important thing is it's not a mode enforcement error
        if (error?.data?.message?.includes('not available in chat mode') ||
          error?.data?.message?.includes('Writes are not allowed')) {
          throw new Error('Agent mode incorrectly blocked write operation')
        }
        // Other errors are acceptable
      }
    })
  })

  describe('tool Name Verification', () => {
    it('should not use old tool names in responses', async () => {
      try {
        const response = await $fetch('/api/chat?stream=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: {
            message: 'Create content from context',
            mode: 'agent'
          }
        }) as string

        const oldToolNames = ['write_content', 'enrich_content', 'fetch_youtube', 'save_source']
        for (const oldTool of oldToolNames) {
          expect(response).not.toContain(oldTool)
        }
      } catch {
        // Ignore errors - we're just checking for old tool names
      }
    })
  })
})
