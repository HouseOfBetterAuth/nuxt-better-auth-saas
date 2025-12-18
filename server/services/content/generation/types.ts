import type { H3Event } from 'h3'
import type * as schema from '~~/server/db/schema'
// Runtime values needed for typeof expressions in type definitions

import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'
import type { ConversationIntentSnapshot } from '~~/shared/utils/intent'

export interface ContentGenerationOverrides {
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  schemaTypes?: string[] | null
}

export interface ContentGenerationInput {
  organizationId: string
  userId: string
  sourceContentId?: string | null
  sourceText?: string | null
  contentId?: string | null
  conversationHistory?: ChatCompletionMessage[] | null
  overrides?: ContentGenerationOverrides
  systemPrompt?: string
  temperature?: number
  mode?: 'chat' | 'agent'
  intentSnapshot?: ConversationIntentSnapshot | null
  onPlanReady?: (details: ContentPlanDetails) => Promise<void> | void
  event?: H3Event | null
  onProgress?: (message: string) => Promise<void> | void
}

export interface ContentGenerationResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  meta: Record<string, any>
}

export interface SectionUpdateInput {
  organizationId: string
  userId: string
  contentId: string
  sectionId: string
  instructions: string
  temperature?: number
  mode?: 'chat' | 'agent'
  onProgress?: (message: string) => Promise<void> | void
}

export interface SectionUpdateResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  section: {
    id: string
    title: string
    index: number
  }
  lineRange?: { start: number, end: number } | null
  diffStats?: { additions: number, deletions: number }
}

export interface ContentChunk {
  chunkIndex: number
  text: string
  textPreview: string
  sourceContentId?: string | null
  embedding?: number[] | null
}

export interface ContentOutlineSection {
  id: string
  index: number
  title: string
  type: string
  notes?: string
}

export interface ContentOutline {
  outline: ContentOutlineSection[]
  seo: {
    title?: string
    description?: string
    keywords?: string[]
    schemaType?: string
    schemaTypes?: string[]
    slugSuggestion?: string
  }
}

export interface RecipeMetadata {
  yield?: string | null
  prepTime?: string | null
  cookTime?: string | null
  totalTime?: string | null
  calories?: string | null
  cuisine?: string | null
  ingredients?: string[]
  instructions?: string[]
}

export interface HowToMetadata {
  estimatedCost?: string | null
  totalTime?: string | null
  difficulty?: string | null
  supplies?: string[]
  tools?: string[]
  steps?: string[]
}

export interface CourseModuleMetadata {
  title?: string
  description?: string | null
  mode?: string | null
}

export interface CourseMetadata {
  providerName?: string | null
  providerUrl?: string | null
  courseCode?: string | null
  modules?: CourseModuleMetadata[]
}

export interface FaqEntryMetadata {
  question: string
  answer: string
}

export interface FaqMetadata {
  description?: string | null
  entries?: FaqEntryMetadata[]
}

export interface ContentFrontmatter {
  title: string
  description?: string
  slug: string
  slugSuggestion: string
  tags?: string[]
  keywords?: string[]
  status: typeof CONTENT_STATUSES[number]
  contentType: typeof CONTENT_TYPES[number]
  schemaTypes: string[]
  primaryKeyword?: string | null
  targetLocale?: string | null
  sourceContentId?: string | null
  recipe?: RecipeMetadata
  howTo?: HowToMetadata
  course?: CourseMetadata
  faq?: FaqMetadata
}

export interface ContentPlanDetails {
  plan: ContentOutline
  frontmatter: ContentFrontmatter
}

export interface ContentSection {
  id: string
  index: number
  type: string
  title: string
  level: number
  anchor: string
  summary?: string | null
  body: string
  wordCount: number
  meta?: Record<string, any>
}

export interface ImageSuggestion {
  sectionId: string
  position: number
  altText: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  type?: 'generated' | 'screencap'
  videoId?: string
  estimatedTimestamp?: number
  thumbnailFileId?: string
  thumbnailUrl?: string
  fullSizeFileId?: string
  fullSizeUrl?: string
  status?: 'pending' | 'thumbnail_ready' | 'added'
}
