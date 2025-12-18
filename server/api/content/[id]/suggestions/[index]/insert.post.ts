import { getRouterParams } from 'h3'
import { insertImageSuggestion } from '~~/server/services/content/generation'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateNumber, validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)
  const { id, index } = getRouterParams(event)

  const contentId = validateUUID(id, 'contentId')
  const suggestionIndex = validateNumber(index, 'suggestionIndex', 0)

  const result = await insertImageSuggestion(db, {
    organizationId,
    userId: user.id,
    contentId,
    suggestionIndex
  })

  return result
})
