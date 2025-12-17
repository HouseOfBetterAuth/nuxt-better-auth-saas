import { defineEventHandler } from 'h3'
import { getAuthSession } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)

  if (!session) {
    return { session: null, user: null }
  }

  return {
    session: session.session,
    user: session.user
  }
})
