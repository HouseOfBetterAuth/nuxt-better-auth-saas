import { eq } from 'drizzle-orm'
import { createError, getQuery, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import { getWorkspaceWithCache } from '~~/server/services/content/workspaceCache'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

async function findWorkspaceAcrossOrganizations(
  db: ReturnType<typeof getDB>,
  userId: string,
  activeOrganizationId: string,
  contentId: string,
  includeChat: boolean
) {
  try {
    return await getWorkspaceWithCache(db, activeOrganizationId, contentId, { includeChat })
  } catch (error: any) {
    if (error?.statusCode !== 404) {
      throw error
    }
  }

  const organizations = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))

  for (const org of organizations) {
    if (org.organizationId === activeOrganizationId) {
      continue
    }
    try {
      return await getWorkspaceWithCache(db, org.organizationId, contentId, { includeChat })
    } catch (error: any) {
      if (error?.statusCode !== 404) {
        console.error('[workspace/:id] Failed to load workspace in alternate org', {
          contentId,
          organizationId: org.organizationId,
          userId,
          error: error?.message || error
        })
      }
    }
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Content not found'
  })
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { contentId } = getRouterParams(event)
  const validatedContentId = validateUUID(contentId, 'contentId')
  const query = getQuery(event)
  const includeChatParam = Array.isArray(query.includeChat) ? query.includeChat[0] : query.includeChat
  const includeChat = includeChatParam === 'true' || includeChatParam === '1'

  const workspace = await findWorkspaceAcrossOrganizations(db, user.id, organizationId, validatedContentId, includeChat)

  return {
    workspace
  }
})
