import { eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { findChatSession, getSessionLogs } from '~~/server/services/chatSession'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

async function resolveSession(
  db: ReturnType<typeof getDB>,
  userId: string,
  activeOrganizationId: string,
  contentId: string
) {
  const session = await findChatSession(db, activeOrganizationId, contentId)
  if (session) {
    return { session, organizationId: activeOrganizationId }
  }

  const organizations = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))

  for (const org of organizations) {
    if (org.organizationId === activeOrganizationId) {
      continue
    }
    const otherSession = await findChatSession(db, org.organizationId, contentId)
    if (otherSession) {
      return { session: otherSession, organizationId: org.organizationId }
    }
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Chat session not found'
  })
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { contentId } = getRouterParams(event)
  const validatedContentId = validateUUID(contentId, 'contentId')

  let resolvedSession
  try {
    resolvedSession = await resolveSession(db, user.id, organizationId, validatedContentId)
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return { logs: [] }
    }
    throw error
  }

  const logs = await getSessionLogs(db, resolvedSession.session.id, resolvedSession.organizationId)

  return {
    logs: logs.map(log => ({
      id: log.id,
      type: log.type,
      message: log.message,
      payload: log.payload,
      createdAt: log.createdAt
    }))
  }
})
