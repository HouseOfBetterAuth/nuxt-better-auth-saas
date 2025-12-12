import { and, desc, eq, sql } from 'drizzle-orm'
import { createError, getQuery, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { createPaginatedResponse } from '~~/server/utils/responses'
import { validateNumber, validateUUID } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/**
 * Get artifacts (content items) produced in a conversation
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id, {
    isAnonymousUser: Boolean(user.isAnonymous)
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

  const query = getQuery(event)

  const getQueryValue = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
      return value[0]
    }
    return value
  }

  const limitRaw = getQueryValue(query.limit as string | string[] | undefined)
  let limit = Number.parseInt(limitRaw ?? '', 10)
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = DEFAULT_LIMIT
  }
  limit = Math.min(limit, MAX_LIMIT)

  const pageRaw = getQueryValue(query.page as string | string[] | undefined)
  let offset: number

  if (pageRaw) {
    const parsedPage = Number.parseInt(pageRaw, 10)
    if (!Number.isFinite(parsedPage)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid page parameter'
      })
    }
    const page = validateNumber(parsedPage, 'page', 1)
    offset = (page - 1) * limit
  } else {
    const offsetRaw = getQueryValue(query.offset as string | string[] | undefined)
    const parsedOffset = Number.parseInt(offsetRaw ?? '0', 10)
    offset = validateNumber(parsedOffset, 'offset', 0)
  }

  const artifactsRaw = await db
    .select({
      contentId: schema.content.id,
      conversationId: schema.content.conversationId,
      title: schema.content.title,
      slug: schema.content.slug,
      status: schema.content.status,
      contentType: schema.content.contentType,
      createdAt: schema.content.createdAt,
      versionId: schema.contentVersion.id,
      versionNumber: schema.contentVersion.version,
      versionFrontmatter: schema.contentVersion.frontmatter,
      totalCount: sql<number>`COUNT(*) OVER()`.as('total_count')
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.conversationId, conversationId),
      eq(schema.content.organizationId, organizationId)
    ))
    .orderBy(desc(schema.content.updatedAt))
    .limit(limit)
    .offset(offset)

  const total = artifactsRaw.length > 0 ? Number(artifactsRaw[0].totalCount ?? 0) : 0

  const artifacts = artifactsRaw.map((row) => ({
    id: row.contentId,
    type: 'content_item' as const,
    conversationId: row.conversationId,
    contentId: row.contentId,
    data: {
      title: row.title,
      slug: row.slug,
      status: row.status,
      contentType: row.contentType,
      currentVersion: row.versionId
        ? {
            id: row.versionId,
            version: row.versionNumber,
            frontmatter: row.versionFrontmatter
          }
        : null
    },
    createdAt: row.createdAt
  }))

  return createPaginatedResponse(artifacts, total, limit, offset)
})
