import { desc, eq } from 'drizzle-orm'
import { getQuery } from 'h3'
import * as schema from '~~/server/database/schema'
import { getContentWorkspacePayload } from '~~/server/services/content/workspace'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const contentId = typeof query.contentId === 'string' && query.contentId.trim().length > 0
    ? query.contentId.trim()
    : null

  const contents = await db
    .select({
      content: schema.content,
      sourceContent: schema.sourceContent,
      currentVersion: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(eq(schema.content.organizationId, organizationId))
    .orderBy(desc(schema.content.updatedAt))
    .limit(100)

  const workspace = contentId
    ? await getContentWorkspacePayload(db, organizationId, contentId)
    : null

  return {
    contents,
    workspace
  }
})
