import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { integration, organization } from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = getQuery(event)
  const code = query.code as string
  const stateBase64 = query.state as string
  const error = query.error as string

  if (error) {
    throw createError({ statusCode: 400, statusMessage: `Google Auth Error: ${error}` })
  }

  if (!code || !stateBase64) {
    throw createError({ statusCode: 400, statusMessage: 'Missing code or state' })
  }

  let state
  try {
    state = JSON.parse(Buffer.from(stateBase64, 'base64').toString())
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid state' })
  }

  if (state.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid user state' })
  }

  const organizationId = state.organizationId

  // Exchange code for tokens
  const tokenResponse = await $fetch<{
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    id_token?: string
  }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: {
      client_id: runtimeConfig.googleClientId,
      client_secret: runtimeConfig.googleClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${runtimeConfig.public.baseURL}/api/organization/google/callback`
    }
  })

  const db = getDB()

  // Check if integration already exists
  const existing = await db.select().from(integration).where(and(
    eq(integration.organizationId, organizationId),
    eq(integration.provider, 'google')
  )).limit(1)

  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)

  if (existing.length > 0) {
    await db.update(integration).set({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || existing[0].refreshToken,
      expiresAt,
      scopes: tokenResponse.scope,
      status: 'connected',
      updatedAt: new Date(),
      connectedByUserId: user.id
    }).where(eq(integration.id, existing[0].id))
  } else {
    await db.insert(integration).values({
      id: uuidv7(),
      organizationId,
      provider: 'google',
      type: 'oauth',
      status: 'connected',
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      scopes: tokenResponse.scope,
      connectedByUserId: user.id,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }

  // Fetch org slug to redirect back
  const org = await db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, organizationId)).limit(1)

  return sendRedirect(event, `/${org[0]?.slug}/settings?integration=success`)
})
