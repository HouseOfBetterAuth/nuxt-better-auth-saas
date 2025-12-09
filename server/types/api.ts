/**
 * Standard API error response format
 */

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
 * Request body for chat endpoint
 *
 * @description
 * The chat endpoint uses LLM-driven tool selection. Send natural language messages
 * and the agent will determine which tools to execute automatically.
 */
export interface ChatRequestBody {
  /** User message (natural language) */
  message: string
  /** Optional existing conversation to continue */
  conversationId?: string | null
  /**
   * Optional content ID to link the conversation to.
   * Used for conversation linking to provide context about the current content.
   *
   * **Use cases:**
   * - Link a conversation to an existing content item for context
   * - Continue a conversation about a specific piece of content
   */
  contentId?: string | null
  /** Chat mode: 'chat' for read-only, 'agent' for read+write */
  mode: 'chat' | 'agent'
}
