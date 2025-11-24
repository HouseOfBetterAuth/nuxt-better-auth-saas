import { generateContentDraft } from '~~/server/services/content/generation'
import { requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface GenerateContentBody {
  text?: string
  sourceContentId?: string | null
  contentId?: string | null
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  systemPrompt?: string
  temperature?: number
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const body = await readBody<GenerateContentBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  const overrides = {
    title: typeof body.title === 'string' ? body.title : null,
    slug: typeof body.slug === 'string' ? body.slug : null,
    status: body.status && CONTENT_STATUSES.includes(body.status) ? body.status : undefined,
    primaryKeyword: typeof body.primaryKeyword === 'string' ? body.primaryKeyword : null,
    targetLocale: typeof body.targetLocale === 'string' ? body.targetLocale : null,
    contentType: body.contentType && CONTENT_TYPES.includes(body.contentType) ? body.contentType : undefined
  }

  const result = await generateContentDraft(db, {
    organizationId,
    userId: user.id,
    text: body.text,
    sourceContentId: body.sourceContentId ?? null,
    contentId: body.contentId ?? null,
    overrides,
    systemPrompt: body.systemPrompt,
    temperature: body.temperature
  })

  return {
    content: result.content,
    version: result.version,
    markdown: result.markdown,
    meta: result.meta
  }
})
