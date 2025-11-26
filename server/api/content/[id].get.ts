import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/database/schema'
import {
  findChatSession,
  getSessionLogs,
  getSessionMessages
} from '~~/server/services/chatSession'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid content id is required'
    })
  }

  const rows = await db
    .select({
      content: schema.content,
      sourceContent: schema.sourceContent,
      currentVersion: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, id)
    ))
    .limit(1)

  const record = rows[0]

  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  let chatSession = null
  let chatMessages: Array<{
    id: string
    role: string
    content: string
    payload?: Record<string, any> | null
    createdAt: Date
  }> = []
  let chatLogs: Array<{
    id: string
    type: string
    message: string
    payload?: Record<string, any> | null
    createdAt: Date
  }> = []

  try {
    const session = await findChatSession(db, organizationId, record.content.id)

    if (session) {
      const [messages, logs] = await Promise.all([
        getSessionMessages(db, session.id, organizationId),
        getSessionLogs(db, session.id, organizationId)
      ])

      chatSession = session
      chatMessages = messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        payload: message.payload,
        createdAt: message.createdAt
      }))
      chatLogs = logs.map(log => ({
        id: log.id,
        type: log.type,
        message: log.message,
        payload: log.payload,
        createdAt: log.createdAt
      }))
    }
  } catch (error) {
    console.error('Failed to load chat session', {
      contentId: record.content.id,
      organizationId,
      error
    })
  }

  return {
    ...record,
    chatSession,
    chatMessages,
    chatLogs
  }
})
