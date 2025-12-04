import { getHeader, getRequestURL } from 'h3'
import { useServerAuth } from '~~/server/utils/auth'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const shouldLogAuthRequests = process.env.NODE_ENV === 'production'

export default defineEventHandler((event) => {
  if (shouldLogAuthRequests) {
    const origin = getHeader(event, 'origin')
    const host = getHeader(event, 'host')
    const url = getRequestURL(event)
    console.log('[Auth] Incoming auth request', {
      method: event.node.req.method,
      path: url.pathname,
      origin,
      host,
      runtimeBaseURL: runtimeConfig.public.baseURL
    })
  }
  const serverAuth = useServerAuth()
  return serverAuth.handler(toWebRequest(event))
})
