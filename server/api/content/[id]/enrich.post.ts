import { getRouterParams, readBody } from 'h3'
import { reEnrichContentVersion } from '~~/server/services/content/generation'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

interface ReEnrichContentRequestBody {
  baseUrl?: string
}

/**
 * Re-enriches existing content with frontmatter and JSON-LD
 *
 * @description Re-enriches the current version of content with frontmatter and JSON-LD structured data.
 * This is useful for updating old content that was created before enrichment was added.
 *
 * @param id - Content ID (from route)
 * @param baseUrl - Optional base URL for generating absolute URLs in JSON-LD
 * @returns Updated content version with enriched MDX
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const { id } = getRouterParams(event)

  const validatedContentId = validateUUID(id, 'contentId')

  const body = await readBody<ReEnrichContentRequestBody>(event).catch(() => ({}))
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : undefined

  const result = await reEnrichContentVersion(db, {
    organizationId,
    userId: user.id,
    contentId: validatedContentId,
    baseUrl
  })

  return result
})
