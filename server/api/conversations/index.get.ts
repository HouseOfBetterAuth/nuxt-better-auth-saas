import { desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'
import { getConversationQuotaUsage, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

/**
 * List conversations for the organization with artifact previews
 * Returns conversations with their associated content artifacts and quota information
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const db = getDB()

  // Get organizationId from Better Auth session
  let organizationId: string | null = null
  try {
    const orgResult = await requireActiveOrganization(event, user.id, { isAnonymousUser: user.isAnonymous ? true : undefined })
    organizationId = orgResult.organizationId
  } catch (error) {
    if (user.isAnonymous) {
      const anonymousLimit = typeof (runtimeConfig.public as any)?.conversationQuota?.anonymous === 'number'
        ? (runtimeConfig.public as any).conversationQuota.anonymous
        : 10

      return {
        conversations: [],
        conversationQuota: {
          limit: anonymousLimit,
          used: 0,
          remaining: anonymousLimit,
          label: 'Guest access',
          unlimited: false,
          profile: 'anonymous'
        }
      }
    }
    throw error
  }

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Active organization not found'
    })
  }

  // Get conversations with artifact counts
  const conversations = await db
    .select({
      conversation: {
        id: schema.conversation.id,
        organizationId: schema.conversation.organizationId,
        contentId: schema.conversation.contentId,
        sourceContentId: schema.conversation.sourceContentId,
        createdByUserId: schema.conversation.createdByUserId,
        status: schema.conversation.status,
        metadata: schema.conversation.metadata,
        createdAt: schema.conversation.createdAt,
        updatedAt: schema.conversation.updatedAt
      },
      // Count artifacts (content items) for this conversation
      artifactCount: sql<number>`COALESCE((
        SELECT COUNT(*)
        FROM ${schema.content}
        WHERE ${schema.content.conversationId} = ${schema.conversation.id}
      ), 0)`,
      // Get first artifact title for preview
      firstArtifactTitle: sql<string | null>`(
        SELECT ${schema.content.title}
        FROM ${schema.content}
        WHERE ${schema.content.conversationId} = ${schema.conversation.id}
        ORDER BY ${schema.content.updatedAt} DESC
        LIMIT 1
      )`
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.organizationId, organizationId))
    .orderBy(desc(schema.conversation.updatedAt))
    .limit(100)

  const conversationQuota = await getConversationQuotaUsage(db, organizationId, user, event)

  return {
    conversations: conversations.map(row => ({
      id: row.conversation.id,
      organizationId: row.conversation.organizationId,
      contentId: row.conversation.contentId,
      sourceContentId: row.conversation.sourceContentId,
      createdByUserId: row.conversation.createdByUserId,
      status: row.conversation.status,
      metadata: row.conversation.metadata,
      createdAt: row.conversation.createdAt,
      updatedAt: row.conversation.updatedAt,
      _computed: {
        artifactCount: Number(row.artifactCount) || 0,
        firstArtifactTitle: row.firstArtifactTitle || null
      }
    })),
    conversationQuota
  }
})
