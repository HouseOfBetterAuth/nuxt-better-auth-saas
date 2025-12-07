import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'
import { createChunksFromSourceContentText } from '~~/server/services/sourceContent/chunkSourceContent'
import {
  buildVectorId,
  embedText,
  embedTexts,
  isVectorizeConfigured,
  queryVectorMatches,
  upsertVectors
} from '~~/server/services/vectorize'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { ensureEmailVerifiedDraftCapacity } from '~~/server/utils/auth'
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  ensureUniqueContentSlug,
  resolveIngestMethodFromSourceContent,
  slugifyTitle
} from '~~/server/utils/content'

interface GenerateContentOverrides {
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  schemaTypes?: string[] | null
}

export interface GenerateContentInput {
  organizationId: string
  userId: string
  sourceContentId?: string | null
  contentId?: string | null
  overrides?: GenerateContentOverrides
  systemPrompt?: string
  temperature?: number
  onPlanReady?: (details: PlanReadyDetails) => Promise<void> | void
  event?: H3Event | null
}

export interface GenerateContentResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  meta: Record<string, any>
}

interface PatchContentSectionInput {
  organizationId: string
  userId: string
  contentId: string
  sectionId: string
  instructions: string
  temperature?: number
}

interface PatchContentSectionResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  section: {
    id: string
    title: string
    index: number
  }
}

interface PipelineChunk {
  chunkIndex: number
  text: string
  textPreview: string
  sourceContentId?: string | null
  embedding?: number[] | null
}

interface OutlineSection {
  id: string
  index: number
  title: string
  type: string
  notes?: string
}

interface ContentPlanResult {
  outline: OutlineSection[]
  seo: {
    title?: string
    description?: string
    keywords?: string[]
    schemaType?: string
    schemaTypes?: string[]
    slugSuggestion?: string
  }
}

interface FrontmatterResult {
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

interface PlanReadyDetails {
  plan: ContentPlanResult
  frontmatter: FrontmatterResult
}

interface GeneratedSection {
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

function isFrontmatterResult(value: unknown): value is FrontmatterResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const data = value as Record<string, any>
  return typeof data.title === 'string'
    && typeof data.slug === 'string'
    && typeof data.slugSuggestion === 'string'
    && typeof data.status === 'string'
    && typeof data.contentType === 'string'
    && Array.isArray(data.schemaTypes)
}

const PLAN_SYSTEM_PROMPT = 'You are an editorial strategist who preserves the authentic voice and personality of the original content while creating well-structured articles. Focus on maintaining the speaker\'s unique tone, expressions, and authentic voice over generic SEO optimization. Always respond with valid JSON.'
const SECTION_SYSTEM_PROMPT = 'You are a skilled writer who preserves the original author\'s unique voice, personality, and authentic expressions while creating well-structured content. Maintain casual language, personal anecdotes, specific details, and the authentic tone from the source material. Write in MDX-compatible markdown. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'
const SECTION_PATCH_SYSTEM_PROMPT = 'You are revising a single section of an existing article. Only update that section using the author instructions and contextual transcript snippets. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'
const PLAN_SECTION_LIMIT = 10
const SECTION_CONTEXT_LIMIT = 3

const BASE_SCHEMA_TYPE = 'BlogPosting'
const CONTENT_TYPE_SCHEMA_EXTENSIONS: Partial<Record<typeof CONTENT_TYPES[number], string[]>> = {
  recipe: ['Recipe'],
  how_to: ['HowTo'],
  faq_page: ['FAQPage'],
  course: ['Course']
}

const FRONTMATTER_KEY_ORDER = [
  'title',
  'seoTitle',
  'description',
  'slug',
  'contentType',
  'targetLocale',
  'status',
  'primaryKeyword',
  'keywords',
  'tags',
  'schemaTypes',
  'sourceContentId'
]

const normalizeSchemaTypes = (
  ...candidates: Array<string | string[] | null | undefined>
) => {
  const set = new Set<string>()
  const push = (value?: string | null) => {
    const trimmed = (value ?? '').trim()
    if (trimmed) {
      set.add(trimmed)
    }
  }

  push(BASE_SCHEMA_TYPE)

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(push)
      continue
    }

    push(candidate)
  }

  return Array.from(set)
}

const normalizeKeywords = (value?: string[] | null) => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(keyword => (typeof keyword === 'string' ? keyword.trim() : ''))
    .filter((keyword): keyword is string => Boolean(keyword))
}

const parseJSONResponse = <T>(raw: string, label: string): T => {
  const trimmed = raw.trim()
  const tryParse = (value: string) => {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  let parsed = tryParse(trimmed)

  if (!parsed) {
    const match = trimmed.match(/```json([\s\S]*?)```/i)
    if (match && match[1]) {
      parsed = tryParse(match[1])
    }
  }

  if (!parsed) {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to parse ${label} response from AI`
    })
  }

  return parsed
}

const createChunksFromTextForRAG = (text: string, chunkSize = 1200, overlap = 200): PipelineChunk[] => {
  if (!text) {
    return []
  }

  const effectiveChunkSize = Number.isFinite(chunkSize) ? Math.max(1, Math.floor(chunkSize)) : 1200
  const normalizedOverlap = Number.isFinite(overlap) ? Math.floor(overlap) : 0
  const effectiveOverlap = Math.min(Math.max(normalizedOverlap, 0), effectiveChunkSize - 1)
  const step = Math.max(1, effectiveChunkSize - effectiveOverlap)
  // Ensure overlap is always smaller than the chunk size so the sliding window advances.

  const normalized = text.replace(/\s+/g, ' ').trim()
  const segments: PipelineChunk[] = []
  let index = 0
  let start = 0

  while (start < normalized.length) {
    const end = Math.min(start + effectiveChunkSize, normalized.length)
    const slice = normalized.slice(start, end).trim()
    if (slice) {
      segments.push({
        chunkIndex: index,
        text: slice,
        textPreview: slice.slice(0, 280),
        sourceContentId: null,
        embedding: null
      })
      index += 1
    }

    if (end >= normalized.length) {
      break
    }

    start += step
  }

  return segments
}

const gatherChunkPreview = (chunks: PipelineChunk[], maxChars = 6000) => {
  if (!chunks.length) {
    return 'No transcript snippets available.'
  }

  const parts: string[] = []
  let current = 0

  for (const chunk of chunks) {
    const snippet = chunk.textPreview || chunk.text.slice(0, 400)
    if (!snippet) {
      continue
    }

    const label = `Chunk ${chunk.chunkIndex}: ${snippet}`
    if (current + label.length > maxChars) {
      break
    }

    current += label.length
    parts.push(label)
  }

  const result = parts.join('\n')
  if (!result || !result.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to generate chunk preview - no valid chunks available'
    })
  }
  return result
}

const tokenize = (input: string) => {
  if (!input || !input.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Input is required for tokenization'
    })
  }
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3)
}

const scoreChunk = (chunk: PipelineChunk, tokens: string[]) => {
  if (!tokens.length) {
    return 0
  }

  const text = chunk.text.toLowerCase()
  let score = 0

  for (const token of tokens) {
    if (!token) {
      continue
    }

    const occurrences = text.split(token).length - 1
    score += occurrences
  }

  return score
}

const getRelevantChunksForSection = async (params: {
  chunks: PipelineChunk[]
  outline: OutlineSection
  organizationId: string
  sourceContentId?: string | null
}): Promise<PipelineChunk[]> => {
  const { chunks, outline, organizationId, sourceContentId } = params

  if (!chunks.length) {
    return []
  }

  let queryEmbedding: number[] | null = null

  if (isVectorizeConfigured && sourceContentId) {
    queryEmbedding = await embedText(`${outline.title} ${outline.notes ?? ''}`)
    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to generate embedding for section query'
      })
    }

    const matches = await queryVectorMatches({
      vector: queryEmbedding,
      topK: SECTION_CONTEXT_LIMIT,
      filter: {
        sourceContentId,
        organizationId
      }
    })

    if (matches.length) {
      const chunkMap = new Map(
        chunks.map(item => [buildVectorId(item.sourceContentId || sourceContentId, item.chunkIndex), item])
      )

      const resolvedMatches = matches
        .map(match => chunkMap.get(match.id))
        .filter((item): item is PipelineChunk => Boolean(item))

      if (resolvedMatches.length) {
        return resolvedMatches
      }
    }
  }

  const chunksWithEmbeddings = isVectorizeConfigured
    ? chunks.filter(chunk => Array.isArray(chunk.embedding) && chunk.embedding.length > 0)
    : []

  if (isVectorizeConfigured && chunksWithEmbeddings.length) {
    if (!queryEmbedding) {
      queryEmbedding = await embedText(`${outline.title} ${outline.notes ?? ''}`)
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to generate embedding for section query'
        })
      }
    }

    const scored = chunksWithEmbeddings
      .map(chunk => ({
        chunk,
        score: cosineSimilarity(queryEmbedding!, chunk.embedding as number[])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SECTION_CONTEXT_LIMIT)

    if (scored.length && (scored[0]?.score ?? 0) > 0) {
      return scored.map(item => item.chunk)
    }
  }

  const tokens = tokenize(`${outline.title} ${outline.notes ?? ''}`)
  const scored = chunks.map(chunk => ({ chunk, score: scoreChunk(chunk, tokens) }))
  scored.sort((a, b) => b.score - a.score)

  const top = scored.filter(item => item.score > 0).slice(0, SECTION_CONTEXT_LIMIT)
  if (top.length > 0) {
    return top.map(item => item.chunk)
  }

  return scored.slice(0, SECTION_CONTEXT_LIMIT).map(item => item.chunk)
}

const computeWordCount = (value: string) => {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .length
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || !vecB.length || vecA.length !== vecB.length) {
    return 0
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i += 1) {
    const valueA = vecA[i] ?? 0
    const valueB = vecB[i] ?? 0
    dot += valueA * valueB
    normA += valueA * valueA
    normB += valueB * valueB
  }

  if (!normA || !normB) {
    return 0
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Removed defaultPlan - fail loudly instead of using fallbacks

const generateContentPlan = async (params: {
  contentType: typeof CONTENT_TYPES[number]
  instructions?: string
  chunks: PipelineChunk[]
  sourceTitle?: string | null
}): Promise<ContentPlanResult> => {
  const preview = gatherChunkPreview(params.chunks)
  const prompt = [
    `We are planning a ${params.contentType} that preserves the authentic voice and personality of the original content.`,
    params.sourceTitle ? `Source Title: ${params.sourceTitle}` : 'Source Title: Unknown',
    'Transcript highlights:',
    preview,
    params.instructions ? `Writer instructions: ${params.instructions}` : 'Writer instructions: Maintain the original speaker\'s authentic voice, casual expressions, and personal storytelling style.',
    'Create an outline that reflects the natural flow and personality of the original content. Section titles should capture the speaker\'s authentic way of discussing topics.',
    'Return JSON with shape {"outline": [{"id": string, "index": number, "title": string, "type": string, "notes": string? }], "seo": {"title": string, "description": string, "keywords": string[], "slugSuggestion": string, "schemaTypes": string[] }}.',
    'Always include "BlogPosting" in schemaTypes, then append any additional schema.org types (e.g., Recipe, HowTo, FAQPage) when the content genuinely needs those structures.',
    `Limit outline to ${PLAN_SECTION_LIMIT} sections.`
  ].join('\n\n')

  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7 // Higher temperature for more creative and personality-preserving planning
  })

  const parsed = parseJSONResponse<ContentPlanResult>(raw, 'content plan')

  if (!parsed || typeof parsed !== 'object') {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to parse content plan from AI response'
    })
  }

  if (!Array.isArray(parsed.outline) || parsed.outline.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include a non-empty outline'
    })
  }

  const outline = parsed.outline.slice(0, PLAN_SECTION_LIMIT).map((item, idx) => {
    if (!item.title || !item.title.trim()) {
      throw createError({
        statusCode: 500,
        statusMessage: `Content plan outline item at index ${idx} is missing a title`
      })
    }
    if (!item.id || !item.id.trim()) {
      throw createError({
        statusCode: 500,
        statusMessage: `Content plan outline item "${item.title}" at index ${idx} is missing an id`
      })
    }
    if (!Number.isFinite(item.index)) {
      throw createError({
        statusCode: 500,
        statusMessage: `Content plan outline item "${item.title}" at index ${idx} is missing a valid index`
      })
    }
    if (!item.type || !item.type.trim()) {
      throw createError({
        statusCode: 500,
        statusMessage: `Content plan outline item "${item.title}" at index ${idx} is missing a type`
      })
    }
    return {
      id: item.id,
      index: item.index,
      title: item.title.trim(),
      type: item.type.trim(),
      notes: item.notes?.trim() || undefined
    }
  })

  if (!parsed.seo || typeof parsed.seo !== 'object') {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include SEO metadata'
    })
  }

  if (!parsed.seo.title || !parsed.seo.title.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include a title in SEO metadata'
    })
  }

  const parsedSchemaTypes = normalizeSchemaTypes(parsed.seo?.schemaTypes, parsed.seo?.schemaType)

  if (parsedSchemaTypes.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include at least one schema type'
    })
  }

  if (!parsed.seo.description || !parsed.seo.description.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include a description in SEO metadata'
    })
  }

  if (!parsed.seo.slugSuggestion || !parsed.seo.slugSuggestion.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Content plan must include a slugSuggestion in SEO metadata'
    })
  }

  const plan: ContentPlanResult = {
    outline,
    seo: {
      title: parsed.seo.title.trim(),
      description: parsed.seo.description.trim(),
      keywords: Array.isArray(parsed.seo.keywords) ? parsed.seo.keywords : [],
      schemaType: parsedSchemaTypes[0],
      schemaTypes: parsedSchemaTypes,
      slugSuggestion: slugifyTitle(parsed.seo.slugSuggestion.trim())
    }
  }

  return plan
}

const createFrontmatterFromContentPlan = (params: {
  plan: ContentPlanResult
  overrides?: GenerateContentOverrides
  existingContent?: typeof schema.content.$inferSelect | null
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}): FrontmatterResult => {
  const { plan, overrides, existingContent, sourceContent } = params

  if (!plan.seo.title || !plan.seo.title.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Plan must include a title'
    })
  }

  const resolvedTitle = overrides?.title?.trim() || plan.seo.title
  if (!resolvedTitle || !resolvedTitle.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Title is required. Provide a title in overrides or ensure the plan includes one.'
    })
  }

  const slugInput = overrides?.slug?.trim() || plan.seo.slugSuggestion
  if (!slugInput || !slugInput.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Slug is required. Provide a slug in overrides or ensure the plan includes slugSuggestion.'
    })
  }
  const normalizedSlug = slugifyTitle(slugInput.trim())

  // For new content, default to 'draft'. For existing content, require explicit status or use existing.
  let statusCandidate: typeof CONTENT_STATUSES[number]
  if (overrides?.status) {
    statusCandidate = validateEnum(overrides.status, CONTENT_STATUSES, 'status')
  } else if (existingContent?.status) {
    statusCandidate = validateEnum(existingContent.status, CONTENT_STATUSES, 'status')
  } else {
    // New content defaults to 'draft' - this is a business rule, not a fallback
    statusCandidate = 'draft'
  }

  // contentType must always be provided explicitly or exist on existing content
  let contentTypeCandidate: typeof CONTENT_TYPES[number]
  if (overrides?.contentType) {
    contentTypeCandidate = validateEnum(overrides.contentType, CONTENT_TYPES, 'contentType')
  } else if (existingContent?.contentType) {
    contentTypeCandidate = validateEnum(existingContent.contentType, CONTENT_TYPES, 'contentType')
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: `contentType is required and must be one of: ${CONTENT_TYPES.join(', ')}`
    })
  }

  const resolvedSchemaTypes = normalizeSchemaTypes(
    params.plan.seo.schemaTypes,
    params.plan.seo.schemaType,
    overrides?.schemaTypes,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[contentTypeCandidate]
  )

  if (resolvedSchemaTypes.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Schema types are required'
    })
  }

  const keywordSet = new Set<string>()
  for (const keyword of normalizeKeywords(plan.seo.keywords)) {
    keywordSet.add(keyword)
  }
  const resolvedPrimaryKeyword = overrides?.primaryKeyword ?? existingContent?.primaryKeyword ?? plan.seo.keywords?.[0] ?? null
  if (resolvedPrimaryKeyword) {
    keywordSet.add(resolvedPrimaryKeyword)
  }

  return {
    title: resolvedTitle.trim(),
    description: plan.seo.description || undefined,
    slug: normalizedSlug,
    slugSuggestion: normalizedSlug,
    tags: Array.from(keywordSet),
    keywords: Array.from(keywordSet),
    status: statusCandidate,
    contentType: contentTypeCandidate,
    schemaTypes: resolvedSchemaTypes,
    primaryKeyword: resolvedPrimaryKeyword,
    targetLocale: overrides?.targetLocale ?? existingContent?.targetLocale ?? null,
    sourceContentId: sourceContent?.id ?? existingContent?.sourceContentId ?? null
  }
}

const cleanFrontmatterTitle = (title: string, fallbacks: string[]) => {
  const normalized = (title || '').replace(/\s+/g, ' ').trim()
  for (const value of [normalized, ...fallbacks]) {
    const candidate = (value || '').replace(/\s+/g, ' ').trim()
    if (candidate.length) {
      return candidate
    }
  }
  return 'Untitled Draft'
}

const enrichFrontmatterMetadata = (params: {
  plan: ContentPlanResult
  frontmatter: FrontmatterResult
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}) => {
  const { plan, frontmatter, sourceContent } = params
  const fallbackTitles = [
    plan.seo.title,
    sourceContent?.title
  ].filter((value): value is string => Boolean(value && value.trim()))
  const title = cleanFrontmatterTitle(frontmatter.title, fallbackTitles)
  const slugCandidate = frontmatter.slug || frontmatter.slugSuggestion || title
  const slug = slugifyTitle(slugCandidate)

  const keywordSet = new Set<string>()
  const push = (value?: string | null) => {
    const trimmed = (value || '').trim()
    if (trimmed) {
      keywordSet.add(trimmed)
    }
  }
  const pushMany = (values?: string[] | null) => {
    for (const value of values || []) {
      push(value)
    }
  }

  push(frontmatter.primaryKeyword)
  pushMany(frontmatter.tags)
  pushMany(frontmatter.keywords)
  pushMany(plan.seo.keywords)

  const resolvedSchemaTypes = normalizeSchemaTypes(
    frontmatter.schemaTypes,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[frontmatter.contentType]
  )

  return {
    ...frontmatter,
    title,
    slug,
    slugSuggestion: frontmatter.slugSuggestion || slug,
    tags: Array.from(keywordSet),
    keywords: Array.from(keywordSet),
    description: frontmatter.description || plan.seo.description,
    schemaTypes: resolvedSchemaTypes,
    targetLocale: frontmatter.targetLocale || null
  }
}

const buildFrontmatterFromVersion = (params: {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect | null
}): FrontmatterResult => {
  const versionFrontmatter = params.version?.frontmatter || {}

  const resolvedTitle = versionFrontmatter.title || params.content.title
  if (!resolvedTitle || !resolvedTitle.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content title is required'
    })
  }

  const slugInput = versionFrontmatter.slug || params.content.slug
  if (!slugInput || !slugInput.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content slug is required'
    })
  }

  const statusCandidate = versionFrontmatter.status
    ? validateEnum(versionFrontmatter.status, CONTENT_STATUSES, 'status')
    : validateEnum(params.content.status, CONTENT_STATUSES, 'status')

  const contentTypeCandidate = versionFrontmatter.contentType
    ? validateEnum(versionFrontmatter.contentType, CONTENT_TYPES, 'contentType')
    : validateEnum(params.content.contentType, CONTENT_TYPES, 'contentType')
  const schemaTypes = normalizeSchemaTypes(
    versionFrontmatter.schemaTypes,
    versionFrontmatter.schemaType,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[contentTypeCandidate]
  )

  return {
    title: resolvedTitle.trim(),
    description: versionFrontmatter.description || undefined,
    slug: slugifyTitle(slugInput.trim()),
    slugSuggestion: slugifyTitle(slugInput.trim()),
    tags: Array.isArray(versionFrontmatter.tags) ? normalizeKeywords(versionFrontmatter.tags) : undefined,
    keywords: normalizeKeywords(versionFrontmatter.keywords || versionFrontmatter.tags || []),
    status: statusCandidate,
    contentType: contentTypeCandidate,
    schemaTypes,
    primaryKeyword: versionFrontmatter.primaryKeyword ?? params.content.primaryKeyword ?? null,
    targetLocale: versionFrontmatter.targetLocale ?? params.content.targetLocale ?? null,
    sourceContentId: versionFrontmatter.sourceContentId ?? params.content.sourceContentId ?? null
  }
}

const generateSectionsFromOutline = async (params: {
  outline: OutlineSection[]
  frontmatter: FrontmatterResult
  chunks: PipelineChunk[]
  instructions?: string
  temperature?: number
  organizationId: string
  sourceContentId?: string | null
}): Promise<GeneratedSection[]> => {
  const sections: GeneratedSection[] = []

  for (const item of params.outline) {
    const relevantChunks = await getRelevantChunksForSection({
      chunks: params.chunks,
      outline: item,
      organizationId: params.organizationId,
      sourceContentId: params.sourceContentId
    })
    const contextBlock = relevantChunks.length
      ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 1200)}`).join('\n\n')
      : 'No transcript context available.'

    const prompt = [
      `Section title: ${item.title}`,
      `Section type: ${item.type}`,
      item.notes ? `Plan notes: ${item.notes}` : 'Plan notes: none.',
      `Frontmatter: ${JSON.stringify({
        title: params.frontmatter.title,
        description: params.frontmatter.description,
        tags: params.frontmatter.tags,
        contentType: params.frontmatter.contentType,
        schemaTypes: params.frontmatter.schemaTypes
      })}`,
      params.instructions ? `Additional voice instructions: ${params.instructions}` : 'Voice instructions: Preserve the original speaker\'s authentic voice, personality, casual expressions, personal anecdotes, and unique phrasing. Maintain their natural speaking style and tone rather than converting to formal editorial language.',
      'Transcript context to ground this section:',
      contextBlock,
      'Write this section maintaining the original speaker\'s authentic voice and personality. Use their specific words, phrases, and expressions when possible. Keep their casual tone, personal stories, and unique way of explaining things. Respond with JSON {"body": string, "summary": string?}. "body" must include only the prose content for this section - do NOT include the section heading or title, as it will be added automatically.'
    ].join('\n\n')

    if (!item.title || !item.title.trim()) {
      throw createError({
        statusCode: 500,
        statusMessage: `Outline item at index ${item.index} is missing a title`
      })
    }

    // Temperature is a configuration parameter with a reasonable default
    const temperature = Number.isFinite(params.temperature) && params.temperature !== undefined
      ? params.temperature
      : 0.7

    if (!item.id) {
      throw createError({
        statusCode: 500,
        statusMessage: `Outline item "${item.title}" is missing an id`
      })
    }

    if (!Number.isFinite(item.index)) {
      throw createError({
        statusCode: 500,
        statusMessage: `Outline item "${item.title}" is missing a valid index`
      })
    }

    if (!item.type || !item.type.trim()) {
      throw createError({
        statusCode: 500,
        statusMessage: `Outline item "${item.title}" is missing a type`
      })
    }

    const raw = await callChatCompletions({
      messages: [
        { role: 'system', content: SECTION_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature
    })

    const parsed = parseJSONResponse<{ body?: string, body_mdx?: string, summary?: string }>(raw, `section ${item.title}`)

    if (!parsed.body && !parsed.body_mdx) {
      throw createError({
        statusCode: 500,
        statusMessage: `Section "${item.title}" generation failed: missing body content`
      })
    }

    const body = (parsed.body || parsed.body_mdx || '').trim()
    if (!body) {
      throw createError({
        statusCode: 500,
        statusMessage: `Section "${item.title}" generation failed: body content is empty`
      })
    }

    const headingLevel = item.type === 'subsection' ? 3 : 2
    const anchor = slugifyTitle(item.title)

    sections.push({
      id: item.id,
      index: item.index,
      type: item.type,
      title: item.title,
      level: headingLevel,
      anchor,
      body,
      summary: parsed.summary?.trim() || undefined,
      wordCount: computeWordCount(body),
      meta: {
        planType: item.type,
        notes: item.notes || undefined,
        sourceChunks: relevantChunks.map(chunk => chunk.chunkIndex)
      }
    })
  }

  if (!sections.length) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to generate any sections from the provided plan'
    })
  }

  return sections.sort((a, b) => a.index - b.index)
}

const combineSectionsIntoMarkdown = (params: {
  frontmatter: FrontmatterResult
  sections: GeneratedSection[]
}) => {
  const ordered = [...params.sections].sort((a, b) => a.index - b.index)
  let markdown = `# ${params.frontmatter.title}\n\n`
  let currentOffset = markdown.length

  const sectionsWithOffsets = ordered.map((section) => {
    const level = Math.min(Math.max(section.level || 2, 2), 6)
    const headingLine = section.title ? `${'#'.repeat(level)} ${section.title}` : ''
    const pieces = [headingLine, section.body.trim()].filter(Boolean)
    const block = pieces.join('\n\n')
    const blockWithPadding = `${block}\n\n`
    const startOffset = currentOffset
    markdown += blockWithPadding
    currentOffset = markdown.length

    return {
      ...section,
      startOffset,
      endOffset: startOffset + block.length,
      body_mdx: section.body
    }
  })

  markdown = `${markdown.trim()}\n`

  return {
    markdown,
    sections: sectionsWithOffsets
  }
}

function formatScalarForYaml(value: any, indent = 0): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\r/g, '')
    if (normalized.includes('\n')) {
      const blockIndent = '  '.repeat(indent + 1)
      const indented = normalized.split('\n').map(line => `${blockIndent}${line}`).join('\n')
      return `|\n${indented}`
    }
    return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return JSON.stringify(value)
}

function toYamlLinesForFrontmatter(value: any, indent = 0): string[] {
  const prefix = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) {
      return [`${prefix}[]`]
    }
    return value.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}-`, ...toYamlLinesForFrontmatter(entry, indent + 1)]
      }
      return [`${prefix}- ${formatScalarForYaml(entry, indent)}`]
    })
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, any>)
    if (!entries.length) {
      return [`${prefix}{}`]
    }
    return entries.flatMap(([key, entry]) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}${key}:`, ...toYamlLinesForFrontmatter(entry, indent + 1)]
      }
      return [`${prefix}${key}: ${formatScalarForYaml(entry, indent)}`]
    })
  }
  return [`${prefix}${formatScalarForYaml(value, indent)}`]
}

function orderFrontmatterForBlock(frontmatter: Record<string, any>) {
  const ordered: Record<string, any> = {}
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (frontmatter[key] !== undefined) {
      ordered[key] = frontmatter[key]
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (ordered[key] === undefined) {
      ordered[key] = value
    }
  }
  return ordered
}

function buildFrontmatterBlock(frontmatter: Record<string, any> | null | undefined) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return '---\n---'
  }
  const filtered = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0
      }
      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0
      }
      return value !== null && value !== undefined && value !== ''
    })
  )
  const ordered = orderFrontmatterForBlock(filtered)
  const lines = toYamlLinesForFrontmatter(ordered)
  return ['---', ...lines, '---'].join('\n')
}

function generateJsonLdStructuredData(params: {
  frontmatter: FrontmatterResult
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
}): string {
  const { frontmatter, seoSnapshot, baseUrl } = params
  const schemaTypes = Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes : []
  const normalizedSchemaTypes = schemaTypes
    .map(type => (typeof type === 'string' ? type.trim() : ''))
    .filter((type): type is string => Boolean(type))

  if (!normalizedSchemaTypes.length) {
    return ''
  }

  const structuredData: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': normalizedSchemaTypes[0] || 'BlogPosting'
  }

  // Basic article properties
  if (frontmatter.title) {
    structuredData.headline = frontmatter.title
  }
  if (frontmatter.description) {
    structuredData.description = frontmatter.description
  }
  if (frontmatter.primaryKeyword) {
    structuredData.keywords = frontmatter.primaryKeyword
  }
  if (Array.isArray(frontmatter.keywords) && frontmatter.keywords.length > 0) {
    const keywordEntries = frontmatter.keywords
      .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
      .filter((keyword): keyword is string => Boolean(keyword))
    const normalizedPrimary = typeof frontmatter.primaryKeyword === 'string'
      ? frontmatter.primaryKeyword.trim()
      : ''
    const hasPrimary = normalizedPrimary
      ? keywordEntries.includes(normalizedPrimary)
      : false
    const keywordsList = normalizedPrimary && !hasPrimary
      ? [normalizedPrimary, ...keywordEntries]
      : keywordEntries
    if (keywordsList.length) {
      structuredData.keywords = keywordsList.join(', ')
    }
  }

  // Add datePublished if available
  const seoPlan = seoSnapshot && typeof seoSnapshot === 'object' ? seoSnapshot.plan : null
  if (seoPlan && typeof seoPlan === 'object' && seoPlan.datePublished) {
    structuredData.datePublished = seoPlan.datePublished
  }

  // Add URL if baseUrl is provided
  if (baseUrl && frontmatter.slug) {
    const normalizedBase = baseUrl.replace(/\/+$/, '')
    const normalizedSlug = frontmatter.slug.replace(/^\/+/, '')
    structuredData.url = `${normalizedBase}/${normalizedSlug}`
  }

  // Add additional schema types as nested structures
  if (normalizedSchemaTypes.length > 1) {
    structuredData['@type'] = normalizedSchemaTypes
  }

  const jsonLd = JSON.stringify(structuredData, null, 2)
  return `<script type="application/ld+json">\n${jsonLd}\n</script>`
}

/**
 * Extracts raw markdown from enriched MDX by stripping frontmatter and JSON-LD
 */
function extractRawMarkdownFromEnrichedMdx(enrichedMdx: string): string {
  const trimmed = enrichedMdx.trim()

  // If it doesn't start with '---', it's not enriched, return as-is
  if (!trimmed.startsWith('---')) {
    return trimmed
  }

  // Find the end of frontmatter block (second '---')
  const delimiter = '\n---'
  const frontmatterEnd = trimmed.indexOf(delimiter, 3)
  if (frontmatterEnd === -1) {
    // No closing frontmatter, return as-is
    return trimmed
  }

  // Extract content after frontmatter
  let contentStart = frontmatterEnd + delimiter.length
  // Skip optional Windows line endings or trailing newline
  if (trimmed[contentStart] === '\r') {
    contentStart += 1
  }
  if (trimmed[contentStart] === '\n') {
    contentStart += 1
  }
  let content = trimmed.substring(contentStart).trim()

  // Check if there's a JSON-LD script tag and remove it
  const jsonLdStart = content.indexOf('<script type="application/ld+json">')
  if (jsonLdStart !== -1) {
    const jsonLdEnd = content.indexOf('</script>', jsonLdStart)
    if (jsonLdEnd !== -1) {
      // Remove JSON-LD block and any surrounding whitespace
      const before = content.substring(0, jsonLdStart).trim()
      const after = content.substring(jsonLdEnd + 9).trim()
      content = [before, after].filter(Boolean).join('\n\n')
    }
  }

  return content.trim()
}

/**
 * Enriches markdown with frontmatter and JSON-LD structured data
 */
export function enrichMdxWithMetadata(params: {
  markdown: string
  frontmatter: FrontmatterResult
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
}): string {
  const { markdown, frontmatter, seoSnapshot, baseUrl } = params

  // Extract raw markdown if already enriched
  const rawMarkdown = extractRawMarkdownFromEnrichedMdx(markdown)

  const frontmatterBlock = buildFrontmatterBlock(frontmatter)
  const jsonLd = generateJsonLdStructuredData({ frontmatter, seoSnapshot, baseUrl })

  const parts: string[] = [frontmatterBlock]
  if (jsonLd) {
    parts.push(jsonLd)
  }
  parts.push(rawMarkdown)

  return parts.filter(part => part.trim().length > 0).join('\n\n')
}

const createContentGenerationMetadata = (
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  stages: string[]
) => {
  return {
    generator: {
      engine: 'codex-pipeline',
      generatedAt: new Date().toISOString(),
      stages
    },
    source: sourceContent
      ? {
          id: sourceContent.id,
          type: sourceContent.sourceType,
          externalId: sourceContent.externalId
        }
      : null
  }
}

const createSectionPatchMetadata = (
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  sectionId: string
) => ({
  generator: {
    engine: 'codex-pipeline',
    generatedAt: new Date().toISOString(),
    stages: ['section_patch'],
    sectionId
  },
  source: sourceContent
    ? {
        id: sourceContent.id,
        type: sourceContent.sourceType,
        externalId: sourceContent.externalId
      }
    : null
})

const extractSectionBody = (
  section: Record<string, any>,
  bodyMdx: string | null
) => {
  if (typeof section.body_mdx === 'string' && section.body_mdx.trim().length > 0) {
    return section.body_mdx
  }
  if (typeof section.body === 'string' && section.body.trim().length > 0) {
    return section.body
  }
  if (
    typeof bodyMdx === 'string' &&
    Number.isFinite(section.startOffset) &&
    Number.isFinite(section.endOffset)
  ) {
    return bodyMdx.slice(section.startOffset, section.endOffset).trim()
  }
  return ''
}

const normalizeStoredSections = (
  sectionsData: any,
  bodyMdx: string | null
): GeneratedSection[] => {
  if (!Array.isArray(sectionsData)) {
    return []
  }

  return sectionsData.map((section: Record<string, any>, idx: number) => {
    const id = section.id || section.section_id || `section-${idx}`
    const title = section.title || `Section ${idx + 1}`
    const body = extractSectionBody(section, bodyMdx)

    return {
      id,
      index: Number.isFinite(section.index) ? section.index : idx,
      type: section.type || section.meta?.planType || 'body',
      title,
      level: Number.isFinite(section.level) ? section.level : 2,
      anchor: section.anchor || slugifyTitle(title),
      body,
      summary: section.summary || section.meta?.summary || null,
      wordCount: Number.isFinite(section.wordCount) ? section.wordCount : computeWordCount(body),
      meta: section.meta || {}
    }
  })
}

const ensureChunksExistForSourceContent = async (
  db: NodePgDatabase<typeof schema>,
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  fallbackText: string | null
): Promise<PipelineChunk[]> => {
  if (!sourceContent?.id) {
    if (!fallbackText || !fallbackText.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Source content is required. Provide a sourceContentId or fallback text.'
      })
    }
    const virtualChunks = createChunksFromTextForRAG(fallbackText)
    if (virtualChunks.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Failed to create chunks from fallback text'
      })
    }
    if (isVectorizeConfigured) {
      const embeddings = await embedTexts(virtualChunks.map(chunk => chunk.text))
      if (embeddings.length !== virtualChunks.length) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to generate embeddings for all chunks'
        })
      }
      virtualChunks.forEach((chunk, idx) => {
        chunk.embedding = embeddings[idx] ?? null
      })
    }
    return virtualChunks
  }

  let chunks = await db
    .select({
      id: schema.chunk.id,
      chunkIndex: schema.chunk.chunkIndex,
      text: schema.chunk.text,
      textPreview: schema.chunk.textPreview,
      embedding: schema.chunk.embedding,
      sourceContentId: schema.chunk.sourceContentId,
      organizationId: schema.chunk.organizationId
    })
    .from(schema.chunk)
    .where(eq(schema.chunk.sourceContentId, sourceContent.id))
    .orderBy(asc(schema.chunk.chunkIndex))

  if (chunks.length === 0) {
    if (!sourceContent.sourceText || !sourceContent.sourceText.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Source content has no text to chunk'
      })
    }
    await createChunksFromSourceContentText({ db, sourceContent })
    chunks = await db
      .select()
      .from(schema.chunk)
      .where(eq(schema.chunk.sourceContentId, sourceContent.id))
      .orderBy(asc(schema.chunk.chunkIndex))

    if (chunks.length === 0) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create chunks from source content'
      })
    }
  }

  if (isVectorizeConfigured) {
    const missingEmbeddings = chunks.filter(chunk => !Array.isArray(chunk.embedding) || chunk.embedding.length === 0)
    if (missingEmbeddings.length) {
      const embeddings = await embedTexts(missingEmbeddings.map(chunk => chunk.text))
      if (embeddings.length !== missingEmbeddings.length) {
        throw createError({
          statusCode: 500,
          statusMessage: `Failed to generate embeddings: expected ${missingEmbeddings.length}, got ${embeddings.length}`
        })
      }
      const chunkEmbeddings = missingEmbeddings.map((chunk, idx) => {
        const embedding = embeddings[idx]
        if (!embedding) {
          throw createError({
            statusCode: 500,
            statusMessage: `Missing embedding data for chunk ${chunk.id}`
          })
        }
        return { chunk, embedding }
      })

      await Promise.all(chunkEmbeddings.map(({ chunk, embedding }) => {
        chunk.embedding = embedding
        return db
          .update(schema.chunk)
          .set({ embedding })
          .where(eq(schema.chunk.id, chunk.id))
      }))

      await upsertVectors(chunkEmbeddings.map(({ chunk, embedding }) => ({
        id: buildVectorId(chunk.sourceContentId, chunk.chunkIndex),
        values: embedding,
        metadata: {
          sourceContentId: chunk.sourceContentId,
          organizationId: chunk.organizationId,
          chunkIndex: chunk.chunkIndex
        }
      })))
    }
  }

  return chunks.map(item => ({
    chunkIndex: item.chunkIndex,
    text: item.text,
    textPreview: item.textPreview ?? item.text.slice(0, 280),
    sourceContentId: item.sourceContentId,
    embedding: item.embedding ?? null
  }))
}

/**
 * Generates a content draft from a source content (transcript, YouTube video, etc.)
 *
 * @param db - Database instance
 * @param input - Input parameters for content generation
 * @returns Generated content draft with markdown and metadata
 */
export const generateContentDraftFromSource = async (
  db: NodePgDatabase<typeof schema>,
  input: GenerateContentInput
): Promise<GenerateContentResult> => {
  const {
    organizationId,
    userId,
    sourceContentId,
    contentId,
    overrides,
    systemPrompt,
    temperature,
    event
  } = input

  if (!organizationId || !userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization and user context are required'
    })
  }

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null

  if (sourceContentId) {
    const [row] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, sourceContentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Source content not found for this organization'
      })
    }

    sourceContent = row

    // Log for debugging
    console.log('[generateContentDraftFromSource] Source content found:', {
      id: sourceContent.id,
      ingestStatus: sourceContent.ingestStatus,
      sourceTextLength: sourceContent.sourceText?.length || 0,
      hasSourceText: !!sourceContent.sourceText?.trim(),
      sourceType: sourceContent.sourceType,
      externalId: sourceContent.externalId
    })
  }

  let existingContent: typeof schema.content.$inferSelect | null = null

  if (contentId) {
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, contentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found for this organization'
      })
    }

    existingContent = row
  }

  if (!sourceContentId || !sourceContent?.sourceText?.trim()) {
    console.error('[generateContentDraftFromSource] Missing sourceText:', {
      sourceContentId,
      hasSourceContent: !!sourceContent,
      sourceTextLength: sourceContent?.sourceText?.length || 0,
      sourceTextPreview: sourceContent?.sourceText?.substring(0, 100) || 'null/empty',
      ingestStatus: sourceContent?.ingestStatus
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'A source transcript is required to create a draft'
    })
  }

  const chunks = await ensureChunksExistForSourceContent(db, sourceContent, sourceContent.sourceText)
  const resolvedIngestMethod = resolveIngestMethodFromSourceContent(sourceContent)

  if (!contentId) {
    // Fetch user to check email verification status
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found'
      })
    }

    const [membership] = await db
      .select()
      .from(schema.member)
      .where(and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      ))
      .limit(1)

    if (!membership) {
      throw createError({
        statusCode: 403,
        statusMessage: 'User is not a member of this organization'
      })
    }

    await ensureEmailVerifiedDraftCapacity(db, organizationId, user, event)
  }

  // Track pipeline stages as they complete
  const pipelineStages: string[] = []

  // Chunking stage (if chunks were created/verified)
  if (chunks && chunks.length > 0) {
    pipelineStages.push('chunking')
  }

  let contentType: typeof CONTENT_TYPES[number]
  if (overrides?.contentType) {
    contentType = validateEnum(overrides.contentType, CONTENT_TYPES, 'contentType')
  } else if (existingContent?.contentType) {
    contentType = validateEnum(existingContent.contentType, CONTENT_TYPES, 'contentType')
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: `contentType is required and must be one of: ${CONTENT_TYPES.join(', ')}`
    })
  }

  const plan = await generateContentPlan({
    contentType,
    instructions: systemPrompt,
    chunks,
    sourceTitle: sourceContent?.title ?? existingContent?.title ?? null
  })
  pipelineStages.push('plan')

  let frontmatter = createFrontmatterFromContentPlan({
    plan,
    overrides,
    existingContent,
    sourceContent
  })
  frontmatter = enrichFrontmatterMetadata({
    plan,
    frontmatter,
    sourceContent
  })
  pipelineStages.push('frontmatter')

  if (input.onPlanReady) {
    await input.onPlanReady({ plan, frontmatter })
  }

  const sections = await generateSectionsFromOutline({
    outline: plan.outline,
    frontmatter,
    chunks,
    instructions: systemPrompt,
    temperature,
    organizationId,
    sourceContentId: frontmatter.sourceContentId ?? sourceContent?.id ?? null
  })
  pipelineStages.push('sections')

  const assembled = combineSectionsIntoMarkdown({
    frontmatter,
    sections
  })
  pipelineStages.push('assembly')

  const resolvedSourceContentId = frontmatter.sourceContentId ?? sourceContent?.id ?? null
  const selectedStatus = frontmatter.status
  const selectedContentType = frontmatter.contentType
  const primaryKeyword = frontmatter.primaryKeyword ?? null
  const targetLocale = frontmatter.targetLocale ?? null

  // SEO snapshot is created, so SEO stage is complete
  pipelineStages.push('seo')

  const assets = createContentGenerationMetadata(sourceContent, pipelineStages)
  const seoSnapshot = {
    plan: plan.seo,
    primaryKeyword,
    targetLocale,
    contentType: selectedContentType,
    schemaTypes: frontmatter.schemaTypes
  }

  // Enrich MDX with frontmatter and JSON-LD structured data
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: assembled.markdown,
    frontmatter,
    seoSnapshot
  })
  pipelineStages.push('enrichment')

  const result = await db.transaction(async (tx) => {
    let contentRecord = existingContent
    let slug = existingContent?.slug
    const baseSlugInput = overrides?.slug || frontmatter.slugSuggestion || frontmatter.title

    if (!contentRecord) {
      if (!baseSlugInput || !baseSlugInput.trim()) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Slug is required. Provide a slug, slugSuggestion, or title in the plan.'
        })
      }

      const slugCandidate = await ensureUniqueContentSlug(tx, organizationId, baseSlugInput)

      const [inserted] = await tx
        .insert(schema.content)
        .values({
          id: uuidv7(),
          organizationId,
          createdByUserId: userId,
          sourceContentId: resolvedSourceContentId,
          ingestMethod: resolvedIngestMethod,
          title: frontmatter.title,
          slug: slugCandidate,
          status: selectedStatus,
          primaryKeyword,
          targetLocale,
          contentType: selectedContentType,
          currentVersionId: null
        })
        .returning()

      if (!inserted) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to create content record'
        })
      }

      slug = inserted.slug
      contentRecord = inserted
    } else {
      slug = contentRecord.slug

      const shouldUpdateSource = resolvedSourceContentId !== contentRecord.sourceContentId
      const shouldUpdateIngestMethod = resolvedIngestMethod !== contentRecord.ingestMethod
      const shouldUpdate =
        frontmatter.title !== contentRecord.title ||
        selectedStatus !== contentRecord.status ||
        primaryKeyword !== contentRecord.primaryKeyword ||
        targetLocale !== contentRecord.targetLocale ||
        shouldUpdateSource ||
        shouldUpdateIngestMethod ||
        selectedContentType !== contentRecord.contentType

      if (shouldUpdate) {
        const [updatedContent] = await tx
          .update(schema.content)
          .set({
            title: frontmatter.title,
            status: selectedStatus,
            primaryKeyword,
            targetLocale,
            sourceContentId: resolvedSourceContentId,
            ingestMethod: resolvedIngestMethod ?? contentRecord.ingestMethod ?? null,
            contentType: selectedContentType,
            updatedAt: new Date()
          })
          .where(eq(schema.content.id, contentRecord.id))
          .returning()

        if (!updatedContent) {
          throw createError({
            statusCode: 500,
            statusMessage: 'Failed to update content record'
          })
        }

        contentRecord = updatedContent
      }
    }

    if (!contentRecord) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Content record was not resolved.'
      })
    }

    frontmatter = { ...frontmatter, slug: slug as string }

    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, contentRecord.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: contentRecord.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: frontmatter.title,
          description: frontmatter.description,
          slug,
          tags: frontmatter.tags,
          keywords: frontmatter.keywords,
          status: selectedStatus,
          contentType: selectedContentType,
          schemaTypes: frontmatter.schemaTypes,
          sourceContentId: resolvedSourceContentId,
          primaryKeyword,
          targetLocale
        },
        bodyMdx: enrichedMdx,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  const meta = {
    engine: 'codex-pipeline',
    stages: {
      outlineSections: plan.outline.length,
      generatedSections: sections.length
    }
  }

  return {
    content: result.content,
    version: result.version,
    markdown: enrichedMdx,
    meta
  }
}

/**
 * Updates a content section using AI based on user instructions
 *
 * @param db - Database instance
 * @param input - Input parameters for section update
 * @returns Updated content with new version and section information
 */
export const updateContentSectionWithAI = async (
  db: NodePgDatabase<typeof schema>,
  input: PatchContentSectionInput
): Promise<PatchContentSectionResult> => {
  const {
    organizationId,
    userId,
    contentId,
    sectionId,
    instructions,
    temperature
  } = input

  const trimmedInstructions = instructions?.trim()

  if (!organizationId || !userId || !contentId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization, user, and content context are required'
    })
  }

  if (!trimmedInstructions) {
    throw createError({
      statusCode: 400,
      statusMessage: 'instructions are required to patch a section'
    })
  }

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion,
      sourceContent: schema.sourceContent
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no version to patch yet'
    })
  }

  const recordContent = record.content
  const currentVersion = record.version

  const normalizedSections = normalizeStoredSections(
    currentVersion.sections,
    currentVersion.bodyMdx ?? null
  )

  if (!normalizedSections.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no structured sections to edit yet'
    })
  }

  const targetSection = normalizedSections.find(section => section.id === sectionId)

  if (!targetSection) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Section not found on this draft'
    })
  }

  const frontmatter = buildFrontmatterFromVersion({
    content: recordContent,
    version: currentVersion
  })

  const chunks = await ensureChunksExistForSourceContent(
    db,
    record.sourceContent ?? null,
    record.sourceContent?.sourceText ?? null
  )

  const relevantChunks = await getRelevantChunksForSection({
    chunks,
    outline: {
      id: targetSection.id,
      index: targetSection.index,
      title: targetSection.title,
      type: targetSection.type,
      notes: trimmedInstructions
    },
    organizationId,
    sourceContentId: record.sourceContent?.id ?? frontmatter.sourceContentId ?? null
  })

  const contextBlock = relevantChunks.length
    ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 600)}`).join('\n\n')
    : 'No transcript context available.'

  const prompt = [
    `You are editing a single section of a ${frontmatter.contentType}.`,
    `Section title: ${targetSection.title}`,
    `Current section body:\n${targetSection.body}`,
    `Author instructions: ${trimmedInstructions}`,
    `Frontmatter: ${JSON.stringify({
      title: frontmatter.title,
      description: frontmatter.description,
      tags: frontmatter.tags,
      contentType: frontmatter.contentType,
      schemaTypes: frontmatter.schemaTypes,
      primaryKeyword: frontmatter.primaryKeyword,
      targetLocale: frontmatter.targetLocale
    })}`,
    'Transcript context to ground this update:',
    contextBlock,
    'Respond with JSON {"body": string, "summary": string?}. Rewrite only this section content - do NOT include the section heading or title, as it will be added automatically.'
  ].join('\n\n')

  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: SECTION_PATCH_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature
  })

  const parsed = parseJSONResponse<{ body?: string, body_mdx?: string, summary?: string }>(raw, 'section patch')
  const updatedBody = (parsed.body ?? parsed.body_mdx ?? '').trim()

  if (!updatedBody) {
    throw createError({
      statusCode: 502,
      statusMessage: 'AI section patch did not return any content'
    })
  }

  const updatedSections = normalizedSections.map((section) => {
    if (section.id !== targetSection.id) {
      return section
    }

    const summary = parsed.summary?.trim() || null
    return {
      ...section,
      body: updatedBody,
      summary,
      wordCount: computeWordCount(updatedBody),
      meta: {
        ...section.meta,
        summary
      }
    }
  })

  const assembled = combineSectionsIntoMarkdown({
    frontmatter,
    sections: updatedSections
  })

  const slug = record.version.frontmatter?.slug || record.content.slug
  const previousSeoSnapshot = currentVersion.seoSnapshot ?? {}
  const assets = createSectionPatchMetadata(record.sourceContent ?? null, targetSection.id)
  const seoSnapshot = {
    ...previousSeoSnapshot,
    primaryKeyword: frontmatter.primaryKeyword,
    targetLocale: frontmatter.targetLocale,
    contentType: frontmatter.contentType,
    schemaTypes: frontmatter.schemaTypes,
    lastPatchedSectionId: targetSection.id,
    patchedAt: new Date().toISOString()
  }

  // Enrich MDX with frontmatter and JSON-LD structured data
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: assembled.markdown,
    frontmatter,
    seoSnapshot
  })

  const result = await db.transaction(async (tx) => {
    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, recordContent.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: recordContent.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: frontmatter.title,
          description: frontmatter.description ?? record.version.frontmatter?.description,
          slug,
          tags: frontmatter.tags,
          keywords: frontmatter.keywords,
          status: frontmatter.status,
          contentType: frontmatter.contentType,
          schemaTypes: frontmatter.schemaTypes,
          sourceContentId: frontmatter.sourceContentId,
          primaryKeyword: frontmatter.primaryKeyword,
          targetLocale: frontmatter.targetLocale
        },
        bodyMdx: enrichedMdx,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, recordContent.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown: enrichedMdx,
    section: {
      id: targetSection.id,
      title: targetSection.title,
      index: targetSection.index
    }
  }
}

/**
 * Re-enriches existing content version with frontmatter and JSON-LD
 *
 * @param db - Database instance
 * @param params - Parameters for re-enrichment
 * @param params.organizationId - Organization ID
 * @param params.userId - User ID
 * @param params.contentId - Content ID
 * @param params.baseUrl - Base URL for content
 * @returns Updated content version with enriched MDX
 */
export async function reEnrichContentVersion(
  db: NodePgDatabase<typeof schema>,
  params: {
    organizationId: string
    userId: string
    contentId: string
    baseUrl?: string
  }
): Promise<{
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  enrichedMdx: string
}> {
  const { organizationId, userId: _userId, contentId, baseUrl } = params

  // Fetch content and current version
  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This content has no version to enrich'
    })
  }

  const currentVersion = record.version
  const rawFrontmatter = currentVersion.frontmatter
  const frontmatter = isFrontmatterResult(rawFrontmatter) ? rawFrontmatter : null
  const seoSnapshot = currentVersion.seoSnapshot as Record<string, any> | null

  if (!frontmatter) {
    console.error('[reEnrichContentVersion] Invalid or missing frontmatter', {
      contentId,
      versionId: currentVersion.id
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'Content version has no frontmatter to use for enrichment'
    })
  }

  // Extract raw markdown from existing bodyMdx (handles both enriched and non-enriched)
  if (!currentVersion.bodyMdx) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content version has no body content to enrich'
    })
  }
  const rawMarkdown = extractRawMarkdownFromEnrichedMdx(currentVersion.bodyMdx)

  // Re-enrich with current frontmatter and seoSnapshot
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: rawMarkdown,
    frontmatter,
    seoSnapshot,
    baseUrl
  })

  // Update the current version's bodyMdx with enriched content
  const result = await db.transaction(async (tx) => {
    const [updatedVersion] = await tx
      .update(schema.contentVersion)
      .set({
        bodyMdx: enrichedMdx
        // Update updatedAt if there's such a field, otherwise just update bodyMdx
      })
      .where(eq(schema.contentVersion.id, currentVersion.id))
      .returning()

    if (!updatedVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content version'
      })
    }

    // Update content's updatedAt timestamp
    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, record.content.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: updatedVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    enrichedMdx
  }
}
