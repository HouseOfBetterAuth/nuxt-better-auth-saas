import { desc, eq } from 'drizzle-orm'
import { getQuery } from 'h3'
import * as schema from '~~/server/database/schema'
import { getContentWorkspacePayload } from '~~/server/services/content/workspace'
import { getDraftQuotaUsage, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateOptionalUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const contentId = validateOptionalUUID(query.contentId, 'contentId')

  const includeListFlag = Array.isArray(query.includeList) ? query.includeList[0] : query.includeList
  const includeList = !contentId || includeListFlag === 'true' || includeListFlag === '1'

  let contents: Array<{
    content: typeof schema.content.$inferSelect
    sourceContent: typeof schema.sourceContent.$inferSelect | null
    currentVersion: typeof schema.contentVersion.$inferSelect | null
  }> = []

  if (includeList) {
    contents = await db
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
  }

  let workspace: Awaited<ReturnType<typeof getContentWorkspacePayload>> | null = null
  if (contentId) {
    try {
      workspace = await getContentWorkspacePayload(db, organizationId, contentId)
    } catch (error: any) {
      // If content not found in active org, try to find it in user's other organizations
      if (error?.statusCode === 404) {
        const userOrgs = await db
          .select({ organizationId: schema.member.organizationId })
          .from(schema.member)
          .where(eq(schema.member.userId, user.id))

        for (const org of userOrgs) {
          try {
            workspace = await getContentWorkspacePayload(db, org.organizationId, contentId)
            if (workspace) {
              console.log('[workspace.get] Found content in different organization', {
                contentId,
                foundInOrg: org.organizationId,
                activeOrg: organizationId
              })
              break
            }
          } catch {
            // Continue searching
          }
        }
      } else {
        console.error('[workspace.get] Failed to load workspace', {
          contentId,
          organizationId,
          userId: user.id,
          error: error?.message || error
        })
      }
    }
  }

  const draftQuota = includeList
    ? await getDraftQuotaUsage(db, organizationId, user, event)
    : null

  return {
    contents,
    workspace,
    draftQuota
  }
})
