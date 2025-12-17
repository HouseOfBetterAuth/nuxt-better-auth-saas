import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'
import { createError, getQuery, getRouterParams } from 'h3'
import { getWorkspaceWithCache } from '~~/server/services/content/workspaceCache'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

async function findWorkspaceForActiveOrganization(
  db: NodePgDatabase<typeof schema>,
  activeOrganizationId: string,
  contentId: string,
  includeChat: boolean
) {
  try {
    return await getWorkspaceWithCache(db, activeOrganizationId, contentId, { includeChat })
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found'
      })
    }
    throw error
  }
}

export default defineEventHandler(async (event) => {
  try {
    await requireAuth(event)
    const { organizationId } = await requireActiveOrganization(event)
    const db = await useDB(event)

    const { id } = getRouterParams(event)
    const validatedContentId = validateUUID(id, 'id')
    const query = getQuery(event)
    const includeChatParam = Array.isArray(query.includeChat) ? query.includeChat[0] : query.includeChat
    const includeChat = includeChatParam === 'true' || includeChatParam === '1'

    const workspace = await findWorkspaceForActiveOrganization(db, organizationId, validatedContentId, includeChat)

    return {
      workspace
    }
  } catch (error) {
    console.error('[Content API] Error:', error)
    if (error instanceof Error) {
      console.error('[Content API] Error name:', error.name)
      console.error('[Content API] Error message:', error.message)
      console.error('[Content API] Error stack:', error.stack)
    } else {
      console.error('[Content API] Error type:', typeof error)
      console.error('[Content API] Error value:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    }
    // Re-throw H3 errors as-is, wrap others
    if (error && typeof error === 'object' && 'statusCode' in error) {
      console.error('[Content API] Re-throwing H3 error with statusCode:', (error as any).statusCode)
      throw error
    }
    console.error('[Content API] Wrapping error in createError')
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
