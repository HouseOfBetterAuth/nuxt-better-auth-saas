import type { ChatMessage } from '#shared/utils/types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'

type ConversationStatus = typeof schema.conversation.$inferSelect['status']

export interface EnsureConversationInput {
  organizationId: string
  sourceContentId?: string | null
  createdByUserId?: string | null
  status?: ConversationStatus
  metadata?: Record<string, any> | null
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
 * Creates a new conversation
 * Note: contentId parameter is removed - content should link to conversation via content.conversationId
 *
 * @param db - Database instance
 * @param input - Input parameters for conversation
 * @returns Newly created conversation
 */
export async function createConversation(
  db: NodePgDatabase<typeof schema>,
  input: EnsureConversationInput
) {
  const status: ConversationStatus = input.status ?? 'active'
  const sourceContentId = input.sourceContentId?.trim() || null
  const createdByUserId = input.createdByUserId?.trim() || null

  const result = await db
    .insert(schema.conversation)
    .values({
      organizationId: input.organizationId,
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

const PREVIEW_MESSAGE_MAX_LENGTH = 280

const normalizePreviewText = (content: string) => {
  if (!content) {
    return ''
  }
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= PREVIEW_MESSAGE_MAX_LENGTH) {
    return normalized
  }
  return `${normalized.slice(0, PREVIEW_MESSAGE_MAX_LENGTH - 3).trimEnd()}...`
}

export interface ConversationPreviewMetadataPatch {
  latestMessage?: {
    role: 'user' | 'assistant' | 'system' | 'function'
    content: string
    createdAt: Date | string
  }
  latestArtifact?: {
    title: string | null
    updatedAt?: Date | string | null
  }
  artifactCount?: number
}

export const patchConversationPreviewMetadata = async (
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  updates: ConversationPreviewMetadataPatch
) => {
  let patch = sql`'{}'::jsonb`
  let hasUpdates = false

  if (updates.latestMessage) {
    hasUpdates = true
    const createdAt = new Date(updates.latestMessage.createdAt).toISOString()
    const previewMessage = normalizePreviewText(updates.latestMessage.content)
    patch = sql`${patch} || jsonb_build_object(
      'latestMessage',
      jsonb_build_object(
        'role', ${updates.latestMessage.role}::text,
        'content', ${previewMessage}::text,
        'createdAt', ${createdAt}::text
      )
    )`
  }

  if (updates.latestArtifact) {
    hasUpdates = true
    const updatedAt = updates.latestArtifact.updatedAt
      ? new Date(updates.latestArtifact.updatedAt).toISOString()
      : null
    patch = sql`${patch} || jsonb_build_object(
      'latestArtifact',
      jsonb_build_object(
        'title', ${updates.latestArtifact.title ?? null}::text,
        'updatedAt', ${updatedAt}::text
      )
    )`
  }

  if (typeof updates.artifactCount === 'number') {
    hasUpdates = true
    // Cast to integer explicitly so PostgreSQL can determine the type
    patch = sql`${patch} || jsonb_build_object('artifactCount', ${updates.artifactCount}::integer)`
  }

  if (!hasUpdates) {
    return
  }

  await db
    .update(schema.conversation)
    .set({
      metadata: sql`
        jsonb_set(
          COALESCE(${schema.conversation.metadata}, '{}'::jsonb),
          '{preview}',
          COALESCE(${schema.conversation.metadata}->'preview', '{}'::jsonb) || (${patch})
        )
      `,
      updatedAt: new Date()
    })
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId)
    ))
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
  // If sourceContentId is provided, try to find existing conversation
  if (input.sourceContentId) {
    const [existing] = await db
      .select()
      .from(schema.conversation)
      .where(and(
        eq(schema.conversation.sourceContentId, input.sourceContentId),
        eq(schema.conversation.organizationId, input.organizationId)
      ))
      .limit(1)

    if (existing) {
      return existing
    }
  }

  // No existing conversation found, create a new one
  return await createConversation(db, input)
}
