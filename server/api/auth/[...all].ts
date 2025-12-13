import { createError, getMethod, getRequestHeaders, getRequestURL, readRawBody } from 'h3'
import { getServerAuth } from '~~/server/utils/auth'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

export default defineEventHandler(async (event) => {
  try {
    const serverAuth = getServerAuth()

    // On Cloudflare Workers, try to use event.request if available
    // Otherwise, construct Request manually using H3 utilities
    let request: Request
    if (runtimeConfig.preset === 'cloudflare-module' && 'request' in event && event.request instanceof Request) {
      // Cloudflare Workers: use event.request directly if available
      request = event.request
    } else {
      // Construct Request manually (works in both Node.js and Cloudflare Workers)
      const url = getRequestURL(event)
      const method = getMethod(event) || 'GET'
      const headers = new Headers(getRequestHeaders(event) as Record<string, string>)
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false)

      request = new Request(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : new Uint8Array(body)) : undefined
      })
    }

    const response = await serverAuth.handler(request)

    // On Cloudflare Workers, return Response directly
    // On Node.js, we need to properly handle the response
    if (runtimeConfig.preset === 'cloudflare-module') {
      return response
    } else {
      // For Node.js, convert Response to H3 response format
      const { sendWebResponse } = await import('h3')
      return sendWebResponse(event, response)
    }
  } catch (error) {
    console.error('[Auth] Unhandled error in auth handler:', error)
    if (error instanceof Error) {
      console.error('[Auth] Error stack:', error.stack)
    }
    // Return a proper error response instead of letting it bubble up as 500
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
