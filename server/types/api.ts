/**
 * Standard API error response format
 */
import type { ContentStatus, ContentType } from './content'

export interface ApiErrorResponse {
  statusCode: number
  statusMessage: string
  data?: Record<string, any>
}

/**
 * Standard pagination parameters
 */
export interface PaginationParams {
  /**
   * Number of items per page.
   * Takes precedence over `perPage` when both are provided.
   */
  limit?: number
  /**
   * Offset for pagination.
   * Takes precedence over `page` when both are provided.
   */
  offset?: number
  /**
   * Page number (alias for offset-based pagination).
   * Used only when `offset` is not provided.
   */
  page?: number
  /**
   * Items per page (alias for limit-based pagination).
   * Used only when `limit` is not provided.
   */
  perPage?: number
}

/**
 * Standard pagination response
 */
export interface PaginationResponse {
  limit: number
  offset: number
  total: number
  hasMore: boolean
  nextOffset: number | null
}

/**
 * Standard list response with pagination
 */
export interface ListResponse<T> {
  data: T[]
  pagination: PaginationResponse
}

/**
 * Chat action types for content generation
 */
export type ChatActionType = 'generate_content' | 'patch_section'

/**
 * Chat action for generating content
 */
export interface ChatActionGenerateContent {
  type: 'generate_content'
  /** Source content ID to generate from (e.g., transcript, YouTube video) */
  sourceContentId?: string | null
  /**
   * Target content ID to generate into (for updating existing draft).
   * If provided, takes precedence over top-level `contentId` for session linking.
   * If null/undefined, a new draft will be created.
   */
  contentId?: string | null
  transcript?: string | null
  title?: string | null
  slug?: string | null
  status?: ContentStatus
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: ContentType
  systemPrompt?: string | null
  temperature?: number | null
}

/**
 * Chat action for patching a section
 */
export interface ChatActionPatchSection {
  type: 'patch_section'
  /**
   * Target content ID to patch a section in.
   * Required when action type is 'patch_section'.
   * This is independent of top-level `contentId` and always refers to the content being patched.
   */
  contentId: string
  sectionId?: string | null
  sectionTitle?: string | null
  instructions?: string | null
  temperature?: number | null
}

/**
 * Union type for all chat actions
 */
export type ChatAction = ChatActionGenerateContent | ChatActionPatchSection

/**
 * Request body for chat endpoint
 */
export interface ChatRequestBody {
  /** User message */
  message: string
  /** Optional existing session to continue */
  sessionId?: string | null
  /**
   * Optional content ID to link the chat session to.
   * Used for session linking when no action is provided or when action doesn't specify contentId.
   *
   * **Precedence rules:**
   * - If `action.type === 'generate_content'` and `action.contentId` is provided,
   *   `action.contentId` takes precedence for session linking.
   * - If `action.type === 'patch_section'`, `action.contentId` is used for patching
   *   (independent of this field).
   * - Otherwise, this field is used for session linking.
   *
   * **Use cases:**
   * - Link a chat session to an existing draft for context
   * - Continue a conversation about a specific piece of content
   */
  contentId?: string | null
  /** Optional action to perform */
  action?: ChatAction
}
