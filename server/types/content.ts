import type { file, publication } from '~~/server/database/schema'
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
 * Request body for writing content from source
 *
 * @description Creates a content item from a source content (transcript, YouTube video, etc.)
 * Either provide sourceContentId or transcript (which will create source content first)
 */
export interface WriteContentRequestBody {
  /** Raw transcript text (alternative to sourceContentId - creates source content first) */
  transcript?: string
  /** ID of existing source content to generate from */
  sourceContentId?: string | null
  /** ID of existing content to update (deprecated - use edit_metadata or edit_section for edits) */
  contentId?: string | null
  /** ID of conversation that this content belongs to */
  conversationId?: string | null
  /** Optional conversation to attach generation messages to */
  conversationContentId?: string | null
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
 * Response from writing content from source
 */
export interface WriteContentResponse {
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
  /** Conversation associated with the generation, if available */
  conversationId?: string | null
  /** Content ID linked to the conversation */
  conversationContentId?: string | null
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
 * Request body for creating content from conversation
 */
export interface CreateContentFromConversationRequestBody {
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

/**
 * Request body for publishing a content version
 */
export interface PublishContentRequestBody {
  /** Optional version ID to publish (defaults to current version) */
  versionId?: string | null
}

/**
 * Response payload returned after publishing a content version
 */
export interface PublishContentResponse {
  content: {
    id: string
    organizationId: string
    slug: string
    title: string
    status: ContentStatus
    contentType: ContentType
    publishedAt: Date | null
    updatedAt: Date
  }
  version: {
    id: string
    contentId: string
    version: number
    createdAt: Date
    frontmatter: Record<string, any> | null
    bodyMdx: string
    bodyHtml: string | null
  }
  file: typeof file.$inferSelect
  publication: typeof publication.$inferSelect
  filePayload: {
    filename: string
    fullMdx: string
    wordCount: number
    sectionsCount: number
    schemaTypes: string[]
    tags: string[]
    seoKeywords: string[]
    frontmatter: Record<string, any>
  }
}
