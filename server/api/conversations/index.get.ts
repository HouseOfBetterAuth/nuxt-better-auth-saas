import { desc, eq, inArray, sql } from 'drizzle-orm'
import { createError, getQuery } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationQuotaUsage, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateNumber } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * List conversations for the organization with artifact previews
 * Returns conversations with their associated content artifacts and quota information
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const db = getDB()
  const query = getQuery(event)

  const getQueryValue = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
      return value[0]
    }
    return value
  }

  const parseOptionalInt = (
    raw: string | undefined,
    field: string,
    defaultValue: number,
    min?: number,
    max?: number
  ) => {
    if (raw === undefined) {
      return defaultValue
    }
    const trimmed = raw.trim()
    if (!trimmed) {
      return defaultValue
    }
    const parsed = validateNumber(trimmed, field, min, max)
    if (!Number.isInteger(parsed)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} must be an integer`
      })
    }
    return parsed
  }

  const limit = parseOptionalInt(
    getQueryValue(query.limit as string | string[] | undefined),
    'limit',
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT
  )

  const pageRaw = getQueryValue(query.page as string | string[] | undefined)
  let offset: number

  if (pageRaw) {
    const page = parseOptionalInt(pageRaw, 'page', 1, 1, 10000)
    offset = (page - 1) * limit
  } else {
    offset = parseOptionalInt(
      getQueryValue(query.offset as string | string[] | undefined) ?? '0',
      'offset',
      0,
      0,
      1000000
    )
  }

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

  // Fetch base conversations
  const conversations = await db
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
      sourceContentId: schema.conversation.sourceContentId,
      createdByUserId: schema.conversation.createdByUserId,
      status: schema.conversation.status,
      metadata: schema.conversation.metadata,
      createdAt: schema.conversation.createdAt,
      updatedAt: schema.conversation.updatedAt
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.organizationId, organizationId))
    .orderBy(desc(schema.conversation.updatedAt))
    .limit(limit)
    .offset(offset)

  // Early return if no conversations
  if (conversations.length === 0) {
    const conversationQuota = await getConversationQuotaUsage(db, organizationId, user, event)
    return {
      conversations: [],
      conversationQuota
    }
  }

  const conversationIds = conversations.map(c => c.id)

  interface RecentArtifactRow {
    conversation_id: string
    title: string
  }
  interface LastMessageRow {
    conversation_id: string
    content: string
  }

  const [
    artifactCountsRaw,
    recentArtifactsRaw,
    lastMessagesRaw,
    conversationQuota
  ] = await Promise.all([
    conversationIds.length
      ? db
          .select({
            conversationId: schema.content.conversationId,
            count: sql<number>`COUNT(*)`.as('count')
          })
          .from(schema.content)
          .where(inArray(schema.content.conversationId, conversationIds))
          .groupBy(schema.content.conversationId)
      : Promise.resolve([]),
    conversationIds.length
      ? db.execute<RecentArtifactRow>(sql`
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          title
        FROM ${schema.content}
        WHERE ${inArray(schema.content.conversationId, conversationIds)}
          AND ${schema.content.organizationId} = ${organizationId}
        ORDER BY conversation_id, ${schema.content.updatedAt} DESC
      `)
      : Promise.resolve({ rows: [] as RecentArtifactRow[] }),
    conversationIds.length
      ? db.execute<LastMessageRow>(sql`
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          content
        FROM ${schema.conversationMessage}
        WHERE ${inArray(schema.conversationMessage.conversationId, conversationIds)}
          AND ${schema.conversationMessage.organizationId} = ${organizationId}
        ORDER BY conversation_id, ${schema.conversationMessage.createdAt} DESC
      `)
      : Promise.resolve({ rows: [] as LastMessageRow[] }),
    getConversationQuotaUsage(db, organizationId, user, event)
  ])

  const artifactCounts = new Map(
    artifactCountsRaw.map(row => [row.conversationId, Number(row.count)])
  )

  const recentArtifacts = new Map(
    recentArtifactsRaw.rows.map(row => [row.conversation_id, row.title])
  )

  const lastMessages = new Map(
    lastMessagesRaw.rows.map(row => [row.conversation_id, row.content])
  )

  return {
    conversations: conversations.map((conv) => {
      const artifactCount = artifactCounts.get(conv.id) || 0
      const recentArtifactTitle = recentArtifacts.get(conv.id) || null
      const lastMessage = lastMessages.get(conv.id) || null
      const title = conv.metadata?.title || 'Untitled conversation'

      return {
        id: conv.id,
        organizationId: conv.organizationId,
        sourceContentId: conv.sourceContentId,
        createdByUserId: conv.createdByUserId,
        status: conv.status,
        metadata: conv.metadata,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        _computed: {
          artifactCount,
          latestArtifactTitle: recentArtifactTitle,
          title,
          lastMessage
        }
      }
    }),
    conversationQuota
  }
})
