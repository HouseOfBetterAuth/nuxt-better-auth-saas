import { and, eq, sql } from 'drizzle-orm'
import { createError, getQuery } from 'h3'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

/**
 * Lightweight endpoint for workspace header - only returns minimal fields needed for header display
 * Full workspace content is loaded via /api/chat/workspace/:contentId when needed
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const contentId = validateUUID(query.contentId as string, 'contentId')

  // Select only minimal fields needed for header
  const rows = await db
    .select({
      content: {
        id: schema.content.id,
        title: schema.content.title,
        status: schema.content.status,
        updatedAt: schema.content.updatedAt,
        currentVersionId: schema.content.currentVersionId
      },
      // Only get frontmatter fields needed for header: contentType, seoTitle, title, diffStats
      frontmatterContentType: sql<string | null>`${schema.contentVersion.frontmatter}->>'contentType'`,
      frontmatterSeoTitle: sql<string | null>`${schema.contentVersion.frontmatter}->>'seoTitle'`,
      frontmatterTitle: sql<string | null>`${schema.contentVersion.frontmatter}->>'title'`,
      diffStats: sql<{ additions?: number, deletions?: number } | null>`${schema.contentVersion.frontmatter}->'diffStats'`,
      versionId: schema.contentVersion.id
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  let record = rows[0]

  if (!record) {
    // Try to find in user's other organizations
    const userOrgs = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, user.id))

    for (const org of userOrgs) {
      const [found] = await db
        .select({
          content: {
            id: schema.content.id,
            title: schema.content.title,
            status: schema.content.status,
            updatedAt: schema.content.updatedAt,
            currentVersionId: schema.content.currentVersionId
          },
          frontmatterContentType: sql<string | null>`${schema.contentVersion.frontmatter}->>'contentType'`,
          frontmatterSeoTitle: sql<string | null>`${schema.contentVersion.frontmatter}->>'seoTitle'`,
          frontmatterTitle: sql<string | null>`${schema.contentVersion.frontmatter}->>'title'`,
          diffStats: sql<{ additions?: number, deletions?: number } | null>`${schema.contentVersion.frontmatter}->'diffStats'`,
          versionId: schema.contentVersion.id
        })
        .from(schema.content)
        .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
        .where(and(
          eq(schema.content.organizationId, org.organizationId),
          eq(schema.content.id, contentId)
        ))
        .limit(1)

      if (found) {
        record = found
        break
      }
    }
  }

  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  const contentType = record.frontmatterContentType || null
  const displayTitle = record.frontmatterSeoTitle || record.frontmatterTitle || record.content.title || 'Untitled draft'
  const diffStats = record.diffStats as { additions?: number, deletions?: number } | null

  // Format updatedAt
  const updatedAt = record.content.updatedAt
  const updatedAtLabel = updatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(updatedAt))
    : '—'

  return {
    title: displayTitle,
    status: record.content.status || null,
    contentType,
    updatedAtLabel,
    versionId: record.versionId || null,
    additions: diffStats?.additions ? Number(diffStats.additions) : 0,
    deletions: diffStats?.deletions ? Number(diffStats.deletions) : 0,
    contentId: record.content.id
  }
})
