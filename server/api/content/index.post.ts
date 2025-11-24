import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, isContentSlugConstraintError, slugifyTitle } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface CreateContentBody {
  title: string
  slug?: string
  sourceContentId?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const body = await readBody<CreateContentBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  if (!body.title || typeof body.title !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'title is required'
    })
  }

  let sourceContentId: string | null = null

  if (body.sourceContentId) {
    const [sourceContent] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, body.sourceContentId))
      .limit(1)

    if (!sourceContent || sourceContent.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Source content not found for this organization'
      })
    }

    sourceContentId = sourceContent.id
  }

  const baseSlug = body.slug
    ? slugifyTitle(body.slug)
    : slugifyTitle(body.title)

  let slug = await ensureUniqueContentSlug(db, organizationId, baseSlug)
  const status = body.status && CONTENT_STATUSES.includes(body.status) ? body.status : 'draft'
  const contentType = body.contentType && CONTENT_TYPES.includes(body.contentType)
    ? body.contentType
    : 'blog_post'

  let createdRecord: typeof schema.content.$inferSelect | null = null
  let attempt = 0
  const maxAttempts = 5

  while (!createdRecord && attempt < maxAttempts) {
    try {
      const [created] = await db
        .insert(schema.content)
        .values({
          id: uuidv7(),
          organizationId,
          createdByUserId: user.id,
          sourceContentId,
          title: body.title,
          slug,
          status,
          primaryKeyword: typeof body.primaryKeyword === 'string' ? body.primaryKeyword : null,
          targetLocale: typeof body.targetLocale === 'string' ? body.targetLocale : null,
          contentType,
          currentVersionId: null
        })
        .returning()

      createdRecord = created
    } catch (error: any) {
      if (isContentSlugConstraintError(error)) {
        attempt += 1
        const fallbackCandidate = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
        slug = await ensureUniqueContentSlug(db, organizationId, fallbackCandidate)
        continue
      }
      throw error
    }
  }

  if (!createdRecord) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to allocate unique slug'
    })
  }

  return createdRecord
})
