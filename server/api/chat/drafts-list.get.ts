import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { getAnonymousDraftUsage } from '~~/server/utils/anonymous'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

/**
 * Lightweight endpoint for drafts list - only returns minimal fields needed for list view
 * Full content is loaded via /api/chat/workspace when a draft is opened
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  // Select only minimal fields needed for list view
  const contents = await db
    .select({
      content: {
        id: schema.content.id,
        title: schema.content.title,
        slug: schema.content.slug,
        status: schema.content.status,
        updatedAt: schema.content.updatedAt,
        contentType: schema.content.contentType,
        currentVersionId: schema.content.currentVersionId,
      },
      sourceContent: {
        sourceType: schema.sourceContent.sourceType,
      },
      // Only get frontmatter for contentType and diffStats, not full frontmatter
      frontmatterContentType: sql<string | null>`${schema.contentVersion.frontmatter}->>'contentType'`,
      diffStats: sql<{ additions?: number; deletions?: number } | null>`${schema.contentVersion.frontmatter}->'diffStats'`,
      // Compute wordCount from sections without loading full sections
      // Handle null contentVersion with COALESCE
      wordCount: sql<number>`COALESCE((
        SELECT SUM(
          CASE 
            WHEN section->>'wordCount' ~ '^[0-9]+$' 
            THEN (section->>'wordCount')::int 
            ELSE 0 
          END
        )
        FROM jsonb_array_elements(COALESCE(${schema.contentVersion.sections}, '[]'::jsonb)) AS section
      ), 0)`,
      sectionsCount: sql<number>`COALESCE(jsonb_array_length(${schema.contentVersion.sections}), 0)`,
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(eq(schema.content.organizationId, organizationId))
    .orderBy(desc(schema.content.updatedAt))
    .limit(100)

  // Transform to match expected format
  const transformedContents = contents.map((row) => {
    const contentType = row.frontmatterContentType || row.content.contentType
    const diffStats = row.diffStats as { additions?: number; deletions?: number } | null

    return {
      content: {
        id: row.content.id,
        title: row.content.title,
        slug: row.content.slug,
        status: row.content.status,
        updatedAt: row.content.updatedAt,
        contentType: row.content.contentType,
        currentVersionId: row.content.currentVersionId,
      },
      sourceContent: row.sourceContent?.sourceType
        ? {
            sourceType: row.sourceContent.sourceType,
          }
        : null,
      currentVersion: {
        frontmatter: {
          contentType,
          diffStats: diffStats || null,
        },
        sections: null, // Not included in list view
      },
      // Pre-computed fields for frontend
      _computed: {
        wordCount: Number.isFinite(row.wordCount) ? Number(row.wordCount) : 0,
        sectionsCount: Number.isFinite(row.sectionsCount) ? Number(row.sectionsCount) : 0,
        additions: diffStats?.additions ? Number(diffStats.additions) : undefined,
        deletions: diffStats?.deletions ? Number(diffStats.deletions) : undefined,
      },
    }
  })

  const anonymousUsage = user.isAnonymous
    ? await getAnonymousDraftUsage(db, organizationId)
    : null

  return {
    contents: transformedContents,
    anonymousUsage,
  }
})

