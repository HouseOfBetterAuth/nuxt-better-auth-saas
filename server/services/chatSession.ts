import type { ChatMessage } from '#shared/utils/types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'

export interface EnsureChatSessionInput {
  organizationId: string
  contentId?: string | null
  sourceContentId?: string | null
  createdByUserId?: string | null
  status?: string
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

export async function ensureChatSession(
  db: NodePgDatabase<typeof schema>,
  input: EnsureChatSessionInput
) {
  // Use transaction to handle race conditions with upsert pattern
  return await db.transaction(async (tx) => {
    const existing = await findChatSession(tx, input.organizationId, input.contentId ?? null)
    if (existing) {
      return existing
    }

    try {
      const [session] = await tx
        .insert(schema.contentChatSession)
        .values({
          organizationId: input.organizationId,
          contentId: input.contentId ?? null,
          sourceContentId: input.sourceContentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
          status: input.status ?? 'active',
          metadata: input.metadata ?? null
        })
        .returning()

      return session
    } catch (error) {
      // If insert fails due to unique constraint, try to find existing session again
      const existingAfterError = await findChatSession(tx, input.organizationId, input.contentId ?? null)
      if (existingAfterError) {
        return existingAfterError
      }
      throw error
    }
  })
}

export interface AddChatMessageInput {
  sessionId: string
  organizationId: string
  role: ChatMessage['role'] | 'system'
  content: string
  payload?: Record<string, any> | null
}

export async function addChatMessage(
  db: NodePgDatabase<typeof schema>,
  input: AddChatMessageInput
) {
  if (!input.content.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Chat message content cannot be empty'
    })
  }

  // Verify session exists and belongs to organization
  const session = await getChatSessionById(db, input.sessionId, input.organizationId)
  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat session not found or access denied'
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

export async function addChatLog(
  db: NodePgDatabase<typeof schema>,
  input: AddChatLogInput
) {
  if (!input.message.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Chat log message cannot be empty'
    })
  }

  // Verify session exists and belongs to organization
  const session = await getChatSessionById(db, input.sessionId, input.organizationId)
  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat session not found or access denied'
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
  organizationId: string,
  options?: { limit?: number, offset?: number }
) {
  const limit = options?.limit ?? 50 // Default limit of 50 messages
  const offset = options?.offset ?? 0

  return await db
    .select()
    .from(schema.contentChatMessage)
    .where(and(
      eq(schema.contentChatMessage.sessionId, sessionId),
      eq(schema.contentChatMessage.organizationId, organizationId)
    ))
    .orderBy(schema.contentChatMessage.createdAt)
    .limit(limit)
    .offset(offset)
}

export async function getSessionLogs(
  db: NodePgDatabase<typeof schema>,
  sessionId: string,
  organizationId: string,
  options?: { limit?: number, offset?: number }
) {
  const limit = options?.limit ?? 100 // Default limit of 100 logs
  const offset = options?.offset ?? 0

  return await db
    .select()
    .from(schema.contentChatLog)
    .where(and(
      eq(schema.contentChatLog.sessionId, sessionId),
      eq(schema.contentChatLog.organizationId, organizationId)
    ))
    .orderBy(schema.contentChatLog.createdAt)
    .limit(limit)
    .offset(offset)
}
