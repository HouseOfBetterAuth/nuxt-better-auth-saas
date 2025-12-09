import { getOrCreateConversationForContent } from '~~/server/services/conversation'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateOptionalUUID } from '~~/server/utils/validation'

/**
 * Create a new conversation
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const body = await readBody(event)
  const contentId = body.contentId ? validateOptionalUUID(body.contentId, 'contentId') : null
  const sourceContentId = body.sourceContentId ? validateOptionalUUID(body.sourceContentId, 'sourceContentId') : null

  const conversation = await getOrCreateConversationForContent(db, {
    organizationId,
    contentId,
    sourceContentId,
    createdByUserId: user.id,
    status: 'active',
    metadata: body.metadata ?? null
  })

  return {
    conversation: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      contentId: conversation.contentId,
      sourceContentId: conversation.sourceContentId,
      createdByUserId: conversation.createdByUserId,
      status: conversation.status,
      metadata: conversation.metadata,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }
  }
})
