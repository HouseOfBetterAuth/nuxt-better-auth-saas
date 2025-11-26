import { createError, getRouterParams } from 'h3'
import { patchContentSection } from '~~/server/services/content/generation'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

interface PatchSectionBody {
  instructions?: string
  temperature?: number
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const { id, sectionId } = getRouterParams(event)

  if (!id || typeof id !== 'string' || !sectionId || typeof sectionId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'content id and section id are required'
    })
  }

  const body = await readBody<PatchSectionBody>(event)
  const instructions = typeof body?.instructions === 'string' ? body.instructions : ''

  const result = await patchContentSection(db, {
    organizationId,
    userId: user.id,
    contentId: id,
    sectionId,
    instructions,
    temperature: body?.temperature
  })

  return result
})
