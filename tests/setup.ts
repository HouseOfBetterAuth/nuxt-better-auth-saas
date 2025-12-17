import {
  AbortController as UndiciAbortController,
  AbortSignal as UndiciAbortSignal,
  fetch as undiciFetch,
  Headers as UndiciHeaders,
  Request as UndiciRequest,
  Response as UndiciResponse
} from 'undici'
import { afterAll, beforeAll } from 'vitest'
import { closeSharedDbPool } from './utils/dbPool'

// Ensure global fetch APIs exist in Vitest (Node) environment
if (!globalThis.fetch) {
  globalThis.fetch = undiciFetch as typeof fetch
}
if (!globalThis.Headers) {
  // @ts-expect-error - assigning to global
  globalThis.Headers = UndiciHeaders
}
if (!globalThis.Request) {
  // @ts-expect-error - assigning to global
  globalThis.Request = UndiciRequest
}
if (!globalThis.Response) {
  // @ts-expect-error - assigning to global
  globalThis.Response = UndiciResponse
}
// AbortController/Signal for both Node and happy-dom windows
if (!globalThis.AbortController) {
  globalThis.AbortController = UndiciAbortController as typeof AbortController
}
if (!globalThis.AbortSignal) {
  globalThis.AbortSignal = UndiciAbortSignal as typeof AbortSignal
}
if (typeof window !== 'undefined') {
  // @ts-expect-error assigning to happy-dom window
  window.AbortController = globalThis.AbortController
  // @ts-expect-error assigning to happy-dom window
  window.AbortSignal = globalThis.AbortSignal
}

;(globalThis as any).__NUXT_TESTING__ = true
if (typeof window !== 'undefined') {
  ;(window as any).__NUXT_TESTING__ = true
}

// Vitest flag for runtime guards
process.env.VITEST = 'true'
process.env.NUXT_TESTING = 'true'
process.env.NUXT_NITRO_PRESET = 'node-server'
if (!process.env.NITRO_PRESET) {
  process.env.NITRO_PRESET = 'node-server'
}

// Cloudflare bindings that Nitro expects when using the CF preset
if (!(globalThis as any).__STATIC_CONTENT_MANIFEST) {
  ;(globalThis as any).__STATIC_CONTENT_MANIFEST = '{}'
}
if (!(globalThis as any).__STATIC_CONTENT) {
  ;(globalThis as any).__STATIC_CONTENT = {}
}
if (!process.env.__STATIC_CONTENT_MANIFEST) {
  process.env.__STATIC_CONTENT_MANIFEST = '{}'
}

// Provide a test-friendly handler for /api/auth/get-session so client composables don't 404 during Vitest runs
const originalFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : 'url' in input
        ? input.url
        : ''

  if (url.endsWith('/api/auth/get-session')) {
    return new Response(JSON.stringify({ session: null, user: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  return originalFetch(input, init)
}

beforeAll(() => {
  // Global setup code can be added here
})

// Clean up shared database pool after all tests
afterAll(async () => {
  await closeSharedDbPool()
})
