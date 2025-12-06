import type { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'

/**
 * Content status values
 */
export type ContentStatus = typeof CONTENT_STATUSES[number]

/**
 * Content type values
 */
export type ContentType = typeof CONTENT_TYPES[number]

/**
 * Request body for generating content draft from source
 *
 * @description Generates a content draft from a source content (transcript, YouTube video, etc.)
 * Either provide sourceContentId or transcript (which will create source content first)
 */
export interface GenerateContentDraftFromSourceRequestBody {
  /** Raw transcript text (alternative to sourceContentId - creates source content first) */
  transcript?: string
  /** ID of existing source content to generate from */
  sourceContentId?: string | null
  /** ID of existing content to regenerate/update */
  contentId?: string | null
  /** Optional chat session to attach generation messages to */
  sessionId?: string | null
  /** Override title for the generated content */
  title?: string | null
  /** Override slug for the generated content */
  slug?: string | null
  /** Override status for the generated content */
  status?: ContentStatus
  /** Primary keyword for SEO */
  primaryKeyword?: string | null
  /** Target locale for the content */
  targetLocale?: string | null
  /** Type of content to generate (blog_post, recipe, etc.) */
  contentType?: ContentType
  /** Custom system prompt for AI generation */
  systemPrompt?: string
  /** Temperature for AI generation (0-2) */
  temperature?: number
}

/**
 * Response from generating content draft from source
 */
export interface GenerateContentDraftFromSourceResponse {
  /** The created/updated content record */
  content: {
    id: string
    organizationId: string
    sourceContentId: string | null
    ingestMethod: string | null
    slug: string
    title: string
    status: ContentStatus
    contentType: ContentType
    primaryKeyword: string | null
    targetLocale: string | null
    currentVersionId: string | null
    createdAt: Date
    updatedAt: Date
    publishedAt: Date | null
  }
  /** The created content version */
  version: {
    id: string
    contentId: string
    version: number
    frontmatter: Record<string, any> | null
    bodyMdx: string
    bodyHtml: string | null
    sections: Record<string, any>[] | null
    assets: Record<string, any> | null
    seoSnapshot: Record<string, any> | null
    createdAt: Date
  }
  /** Full markdown content */
  markdown: string
  /** Generation metadata */
  meta: {
    engine: string
    stages: {
      outlineSections: number
      generatedSections: number
    }
  }
  /** Chat session associated with the generation, if available */
  sessionId?: string | null
  /** Content ID linked to the chat session */
  sessionContentId?: string | null
}

/**
 * Request body for creating content
 */
export interface CreateContentRequestBody {
  /** Title of the content (required) */
  title: string
  /** Slug for the content (auto-generated from title if not provided) */
  slug?: string
  /** ID of source content to link */
  sourceContentId?: string | null
  /** Status of the content (required) */
  status: ContentStatus
  /** Primary keyword for SEO */
  primaryKeyword?: string | null
  /** Target locale for the content */
  targetLocale?: string | null
  /** Type of content (required) */
  contentType: ContentType
}

/**
 * Request body for updating content section with AI
 */
export interface UpdateContentSectionWithAIRequestBody {
  /** ID of the content to update */
  contentId: string
  /** ID of the section to update */
  sectionId: string
  /** Instructions for how to update the section */
  instructions: string
  /** Temperature for AI generation (0-2) */
  temperature?: number
}

/**
 * Request body for creating content from chat session
 */
export interface CreateContentFromChatRequestBody {
  /** Title of the content (required) */
  title: string
  /** Type of content to generate */
  contentType?: ContentType
  /** Array of message IDs to include in transcript */
  messageIds?: string[]
}

/**
 * Response from updating content section with AI
 */
export interface UpdateContentSectionWithAIResponse {
  /** The updated content record */
  content: {
    id: string
    organizationId: string
    slug: string
    title: string
    status: ContentStatus
    contentType: ContentType
  }
  /** The new content version */
  version: {
    id: string
    contentId: string
    version: number
    bodyMdx: string
    sections: Record<string, any>[] | null
  }
  /** Full markdown content */
  markdown: string
  /** Updated section information */
  section: {
    id: string
    title: string
    index: number
  }
}
