import { createError } from 'h3'
import { z } from 'zod'
import { getOrCreateConversationForContent } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateOptionalUUID } from '~~/server/utils/validation'

/**
 * Schema for validating conversation metadata
 * Metadata must be either null or a plain object (Record<string, any>)
 */
const metadataSchema = z.union([
  z.null(),
  z.record(z.string(), z.any())
]).refine(
  val => val === null || (typeof val === 'object' && !Array.isArray(val)),
  { message: 'Metadata must be a plain object or null' }
)

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const body = await readBody(event)
  const sourceContentId = body.sourceContentId ? validateOptionalUUID(body.sourceContentId, 'sourceContentId') : null

  let validatedMetadata: Record<string, any> | null = null
  if (body.metadata !== undefined) {
    const metadataResult = metadataSchema.safeParse(body.metadata)
    if (!metadataResult.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid metadata format',
        data: {
          errors: metadataResult.error.issues
        }
      })
    }
    validatedMetadata = metadataResult.data
  }

  const conversation = await getOrCreateConversationForContent(db, {
    organizationId,
    sourceContentId,
    createdByUserId: user.id,
    status: 'active',
    metadata: validatedMetadata
  })

  return {
    conversation: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      sourceContentId: conversation.sourceContentId,
      createdByUserId: conversation.createdByUserId,
      status: conversation.status,
      metadata: conversation.metadata,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }
  }
})
