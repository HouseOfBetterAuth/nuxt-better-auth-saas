import type { H3Event } from 'h3'
import type * as schema from '~~/server/database/schema'
// Runtime values needed for typeof expressions in type definitions

import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'

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
  onPlanReady?: (details: ContentPlanDetails) => Promise<void> | void
  event?: H3Event | null
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
