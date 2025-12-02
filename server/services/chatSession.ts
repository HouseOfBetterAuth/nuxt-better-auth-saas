import type { ChatMessage } from '#shared/utils/types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'

type ChatSessionStatus = typeof schema.contentChatSession.$inferSelect['status']

export interface EnsureChatSessionInput {
  organizationId: string
  contentId?: string | null
  sourceContentId?: string | null
  createdByUserId?: string | null
  status?: ChatSessionStatus
  metadata?: Record<string, any> | null
}

export async function findChatSession(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  contentId?: string | null
) {
  if (!contentId) {
    return null
  }

  const [session] = await db
    .select()
    .from(schema.contentChatSession)
    .where(and(
      eq(schema.contentChatSession.organizationId, organizationId),
      eq(schema.contentChatSession.contentId, contentId)
    ))
    .orderBy(desc(schema.contentChatSession.createdAt))
    .limit(1)

  return session ?? null
}

export async function getChatSessionById(
  db: NodePgDatabase<typeof schema>,
  sessionId: string,
  organizationId: string
) {
  const [session] = await db
    .select()
    .from(schema.contentChatSession)
    .where(and(
      eq(schema.contentChatSession.id, sessionId),
      eq(schema.contentChatSession.organizationId, organizationId)
    ))
    .limit(1)

  return session ?? null
}

/**
 * Gets an existing chat session for content or creates a new one
 *
 * @param db - Database instance
 * @param input - Input parameters for chat session
 * @returns Existing or newly created chat session
 */
export async function getOrCreateChatSessionForContent(
  db: NodePgDatabase<typeof schema>,
  input: EnsureChatSessionInput
) {
  const existing = await findChatSession(db, input.organizationId, input.contentId ?? null)
  if (existing) {
    return existing
  }

  const status: ChatSessionStatus = input.status ?? 'active'

  const [session] = await db
    .insert(schema.contentChatSession)
    .values({
      organizationId: input.organizationId,
      contentId: input.contentId ?? null,
      sourceContentId: input.sourceContentId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      status,
      metadata: input.metadata ?? null
    })
    .returning()

  return session
}

export interface AddChatMessageInput {
  sessionId: string
  organizationId: string
  role: ChatMessage['role'] | 'system'
  content: string
  payload?: Record<string, any> | null
}

/**
 * Adds a message to a chat session
 *
 * @param db - Database instance
 * @param input - Message input parameters
 * @returns Created message record
 */
export async function addMessageToChatSession(
  db: NodePgDatabase<typeof schema>,
  input: AddChatMessageInput
) {
  if (!input.content.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Chat message content cannot be empty'
    })
  }

  const [message] = await db
    .insert(schema.contentChatMessage)
    .values({
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      role: input.role,
      content: input.content,
      payload: input.payload ?? null
    })
    .returning()

  return message
}

export interface AddChatLogInput {
  sessionId: string
  organizationId: string
  type?: string
  message: string
  payload?: Record<string, any> | null
}

/**
 * Adds a log entry to a chat session
 *
 * @param db - Database instance
 * @param input - Log entry input parameters
 * @returns Created log entry record
 */
export async function addLogEntryToChatSession(
  db: NodePgDatabase<typeof schema>,
  input: AddChatLogInput
) {
  if (!input.message.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Chat log message cannot be empty'
    })
  }

  const [log] = await db
    .insert(schema.contentChatLog)
    .values({
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      type: input.type ?? 'info',
      message: input.message,
      payload: input.payload ?? null
    })
    .returning()

  return log
}

export async function getSessionMessages(
  db: NodePgDatabase<typeof schema>,
  sessionId: string,
  organizationId: string
) {
  return await db
    .select()
    .from(schema.contentChatMessage)
    .where(and(
      eq(schema.contentChatMessage.sessionId, sessionId),
      eq(schema.contentChatMessage.organizationId, organizationId)
    ))
    .orderBy(schema.contentChatMessage.createdAt)
}

export async function getSessionLogs(
  db: NodePgDatabase<typeof schema>,
  sessionId: string,
  organizationId: string
) {
  return await db
    .select()
    .from(schema.contentChatLog)
    .where(and(
      eq(schema.contentChatLog.sessionId, sessionId),
      eq(schema.contentChatLog.organizationId, organizationId)
    ))
    .orderBy(schema.contentChatLog.createdAt)
}
