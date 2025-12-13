import { createError } from 'h3'
import { useServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  try {
    const serverAuth = useServerAuth()
    return await serverAuth.handler(toWebRequest(event))
  } catch (error) {
    console.error('[Auth] Unhandled error in auth handler:', error)
    // Return a proper error response instead of letting it bubble up as 500
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
