import { and, desc, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

/**
 * Get artifacts (content items) produced in a conversation
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id, {
    isAnonymousUser: Boolean((user as any)?.isAnonymous)
  })
  const db = getDB()

  const { id } = getRouterParams(event)
  const conversationId = validateUUID(id, 'id')

  const conversation = await getConversationById(db, conversationId, organizationId)

  if (!conversation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Conversation not found'
    })
  }

  // Get all content items linked to this conversation
  const artifacts = await db
    .select({
      content: schema.content,
      currentVersion: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.conversationId, conversationId),
      eq(schema.content.organizationId, organizationId)
    ))
    .orderBy(desc(schema.content.updatedAt))

  return {
    artifacts: artifacts.map(({ content, currentVersion }) => ({
      id: content.id,
      type: 'content_item' as const,
      conversationId: content.conversationId,
      contentId: content.id,
      data: {
        title: content.title,
        slug: content.slug,
        status: content.status,
        contentType: content.contentType,
        currentVersion: currentVersion
          ? {
              id: currentVersion.id,
              version: currentVersion.version,
              frontmatter: currentVersion.frontmatter
            }
          : null
      },
      createdAt: content.createdAt
    }))
  }
})
