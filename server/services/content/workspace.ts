import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentFrontmatter, ContentSection } from './generation/types'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById, getConversationLogs, getConversationMessages } from '../conversation'
import { generateStructuredDataJsonLd } from './generation'
import { buildWorkspaceSummary } from './workspaceSummary'

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
      sourceContent: schema.sourceContent
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
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

  let currentVersion: typeof schema.contentVersion.$inferSelect | null = null
  if (record.content.currentVersionId) {
    const [versionRow] = await db
      .select()
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.id, record.content.currentVersionId))
      .limit(1)
    currentVersion = versionRow ?? null
  }

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

  let conversation: typeof schema.conversation.$inferSelect | null = null

  // Get conversation via content.conversationId (proper relationship)
  if (record.content.conversationId) {
    try {
      conversation = await getConversationById(db, record.content.conversationId, organizationId)

      if (conversation && includeChat) {
        const [messages, logs] = await Promise.all([
          getConversationMessages(db, conversation.id, organizationId),
          getConversationLogs(db, conversation.id, organizationId)
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
    } catch (error) {
      console.error('Failed to load conversation', {
        conversationId: record.content.conversationId,
        contentId,
        organizationId,
        error
      })
    }
  }

  const workspaceSummary = buildWorkspaceSummary({
    content: record.content,
    currentVersion,
    sourceContent: record.sourceContent
  })

  let structuredData: string | null = null
  if (currentVersion?.frontmatter) {
    structuredData = generateStructuredDataJsonLd({
      frontmatter: currentVersion.frontmatter as ContentFrontmatter,
      seoSnapshot: currentVersion.seoSnapshot as Record<string, any> | null,
      sections: currentVersion.sections as ContentSection[] | null | undefined
    }) || null
  }

  const currentVersionWithDerived = currentVersion
    ? {
        ...currentVersion,
        structuredData
      }
    : null

  return {
    ...record,
    currentVersion: currentVersionWithDerived,
    workspaceSummary,
    chatSession: conversation, // Legacy field name for backwards compatibility
    chatMessages: includeChat ? chatMessages : null,
    chatLogs: includeChat ? chatLogs : null
  }
}
