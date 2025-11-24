import { requireAuth } from '~~/server/utils/auth'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { getDB } from '~~/server/utils/db'
import { member } from '~~/server/database/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = getQuery(event)
  const organizationId = query.organizationId as string

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Organization ID is required'
    })
  }

  // Check if user is admin/owner of this org
  const db = getDB()
  const membership = await db.select().from(member).where(and(
      eq(member.userId, user.id),
      eq(member.organizationId, organizationId)
  )).limit(1)

  if (membership.length === 0 || (membership[0].role !== 'owner' && membership[0].role !== 'admin')) {
     throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to manage integrations for this organization'
    })
  }

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    // Add other scopes as needed
  ]

  const state = JSON.stringify({
    organizationId,
    userId: user.id,
    nonce: Math.random().toString(36).substring(7)
  })
  
  const stateBase64 = Buffer.from(state).toString('base64')

  const params = new URLSearchParams({
    client_id: runtimeConfig.googleClientId,
    redirect_uri: `${runtimeConfig.public.baseURL}/api/organization/google/callback`,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: stateBase64
  })

  return sendRedirect(event, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

