import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'
import { findChatSession, getSessionLogs, getSessionMessages } from '../chatSession'

export async function getContentWorkspacePayload(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  contentId: string,
  options?: { includeChat?: boolean }
) {
  const includeChat = options?.includeChat !== false
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
      eq(schema.content.id, contentId)
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
      chatSession = session
      if (includeChat) {
        const [messages, logs] = await Promise.all([
          getSessionMessages(db, session.id, organizationId),
          getSessionLogs(db, session.id, organizationId)
        ])

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
    }
  } catch (error) {
    console.error('Failed to load chat session', {
      contentId,
      organizationId,
      error
    })
  }

  return {
    ...record,
    chatSession,
    chatMessages: includeChat ? chatMessages : null,
    chatLogs: includeChat ? chatLogs : null
  }
}
