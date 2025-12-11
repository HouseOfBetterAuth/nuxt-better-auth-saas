import type * as schema from '~~/server/db/schema'
import type { ConversationQuotaUsageResult } from '~~/server/utils/auth'

/**
 * Conversation status values
 */
export type ConversationStatus = typeof schema.conversation.$inferSelect['status']

/**
 * Conversation interface
 */
export interface Conversation {
  id: string
  organizationId: string
  contentId: string | null
  sourceContentId: string | null
  createdByUserId: string | null
  status: ConversationStatus
  metadata: Record<string, any> | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Conversation message interface
 */
export interface ConversationMessage {
  id: string
  conversationId: string
  organizationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload: Record<string, any> | null
  createdAt: Date
}

/**
 * Conversation log interface
 */
export interface ConversationLog {
  id: string
  conversationId: string
  organizationId: string
  type: string
  message: string
  payload: Record<string, any> | null
  createdAt: Date
}

/**
 * Artifact interface (for content items, outlines, etc. produced in conversations)
 */
export interface Artifact {
  id: string
  conversationId: string
  type: 'content_item' | 'outline' | 'snippet' | 'transcript' | 'metadata' | 'seo_brief'
  contentId?: string | null
  data: Record<string, any>
  createdAt: Date
}

/**
 * Conversation response with messages and logs
 */
export interface ConversationResponse {
  conversation: Conversation
  messages?: ConversationMessage[]
  logs?: ConversationLog[]
  artifacts?: Artifact[]
}

/**
 * Conversation list response
 */
export interface ConversationListResponse {
  conversations: Conversation[]
  conversationQuota: ConversationQuotaUsageResult
}
