import type { ChatMessage } from '#shared/utils/types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'

type ConversationStatus = typeof schema.conversation.$inferSelect['status']

export interface EnsureConversationInput {
  organizationId: string
  contentId?: string | null
  sourceContentId?: string | null
  createdByUserId?: string | null
  status?: ConversationStatus
  metadata?: Record<string, any> | null
}

export async function findConversation(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  contentId?: string | null
) {
  if (!contentId) {
    return null
  }

  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.organizationId, organizationId),
      eq(schema.conversation.contentId, contentId)
    ))
    .orderBy(desc(schema.conversation.createdAt))
    .limit(1)

  return conv ?? null
}

export async function getConversationById(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string
) {
  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId)
    ))
    .limit(1)

  return conv ?? null
}

/**
 * Gets an existing conversation for content or creates a new one
 *
 * @param db - Database instance
 * @param input - Input parameters for conversation
 * @returns Existing or newly created conversation
 */
export async function getOrCreateConversationForContent(
  db: NodePgDatabase<typeof schema>,
  input: EnsureConversationInput
) {
  const status: ConversationStatus = input.status ?? 'active'

  const contentId = input.contentId?.trim() || null
  const sourceContentId = input.sourceContentId?.trim() || null
  const createdByUserId = input.createdByUserId?.trim() || null

  if (!contentId) {
    const result = await db
      .insert(schema.conversation)
      .values({
        organizationId: input.organizationId,
        contentId: null,
        sourceContentId,
        createdByUserId,
        status,
        metadata: input.metadata ?? null
      })
      .returning()

    const conv = (Array.isArray(result) ? result[0] : null) as typeof schema.conversation.$inferSelect | null
    if (!conv) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create conversation'
      })
    }

    return conv
  }

  const result = await db
    .insert(schema.conversation)
    .values({
      organizationId: input.organizationId,
      contentId,
      sourceContentId,
      createdByUserId,
      status,
      metadata: input.metadata ?? null
    })
    .onConflictDoNothing({
      target: [schema.conversation.organizationId, schema.conversation.contentId]
    })
    .returning()

  const conv = (Array.isArray(result) ? result[0] : null) as typeof schema.conversation.$inferSelect | null

  if (!conv) {
    const existing = await findConversation(db, input.organizationId, contentId)
    if (!existing) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create or retrieve conversation'
      })
    }
    return existing
  }

  return conv
}

export interface AddConversationMessageInput {
  conversationId: string
  organizationId: string
  role: ChatMessage['role'] | 'system'
  content: string
  payload?: Record<string, any> | null
  id?: string // Optional: use this ID instead of generating a new one
}

/**
 * Adds a message to a conversation
 *
 * @param db - Database instance
 * @param input - Message input parameters
 * @returns Created message record
 */
export async function addMessageToConversation(
  db: NodePgDatabase<typeof schema>,
  input: AddConversationMessageInput
) {
  if (!input.content.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Conversation message content cannot be empty'
    })
  }

  const [message] = await db
    .insert(schema.conversationMessage)
    .values({
      id: input.id,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      role: input.role,
      content: input.content,
      payload: input.payload ?? null
    })
    .returning()

  return message
}

export interface AddConversationLogInput {
  conversationId: string
  organizationId: string
  type?: string
  message: string
  payload?: Record<string, any> | null
}

/**
 * Adds a log entry to a conversation
 *
 * @param db - Database instance
 * @param input - Log entry input parameters
 * @returns Created log entry record
 */
export async function addLogEntryToConversation(
  db: NodePgDatabase<typeof schema>,
  input: AddConversationLogInput
) {
  if (!input.message.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Conversation log message cannot be empty'
    })
  }

  const [log] = await db
    .insert(schema.conversationLog)
    .values({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      type: input.type ?? 'info',
      message: input.message,
      payload: input.payload ?? null
    })
    .returning()

  return log
}

export interface GetConversationMessagesOptions {
  limit?: number
  offset?: number
}

export async function getConversationMessages(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  options?: GetConversationMessagesOptions
) {
  const baseQuery = db
    .select()
    .from(schema.conversationMessage)
    .where(and(
      eq(schema.conversationMessage.conversationId, conversationId),
      eq(schema.conversationMessage.organizationId, organizationId)
    ))
    .orderBy(schema.conversationMessage.createdAt)

  if (options?.limit !== undefined) {
    if (options?.offset !== undefined) {
      return await baseQuery.limit(options.limit).offset(options.offset)
    }
    return await baseQuery.limit(options.limit)
  }

  if (options?.offset !== undefined) {
    return await baseQuery.offset(options.offset)
  }

  return await baseQuery
}

export async function getConversationLogs(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string
) {
  return await db
    .select()
    .from(schema.conversationLog)
    .where(and(
      eq(schema.conversationLog.conversationId, conversationId),
      eq(schema.conversationLog.organizationId, organizationId)
    ))
    .orderBy(schema.conversationLog.createdAt)
}
