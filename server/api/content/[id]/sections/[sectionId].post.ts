import type { UpdateContentSectionWithAIRequestBody } from '~~/server/types/content'
import { getRouterParams, readBody } from 'h3'
import { updateContentSection } from '~~/server/services/content/generation'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateNumber, validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'

/**
 * Updates a content section using AI based on user instructions
 *
 * @description Updates a specific section of content using AI generation based on instructions
 *
 * @param id - Content ID (from route)
 * @param sectionId - Section ID to update (from route)
 * @param instructions - Instructions for how to update the section (required)
 * @param temperature - Temperature for AI generation (0-2)
 * @returns Updated content with new version and section information
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)
  const { id, sectionId } = getRouterParams(event)

  const validatedContentId = validateUUID(id, 'contentId')
  const validatedSectionId = validateRequiredString(sectionId, 'sectionId')

  const body = await readBody<UpdateContentSectionWithAIRequestBody>(event)
  validateRequestBody(body)

  const instructions = validateRequiredString(body.instructions, 'instructions')
  const temperature = body.temperature !== undefined
    ? validateNumber(body.temperature, 'temperature', 0, 2)
    : undefined

  const result = await updateContentSection(db, {
    organizationId,
    userId: user.id,
    contentId: validatedContentId,
    sectionId: validatedSectionId,
    instructions,
    temperature
  })

  return result
})
