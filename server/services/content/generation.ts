import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, slugifyTitle } from '~~/server/utils/content'
import { chunkSourceContentText } from '~~/server/services/sourceContent/chunkSourceContent'

interface GenerateContentOverrides {
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
}

export interface GenerateContentInput {
  organizationId: string
  userId: string
  text?: string | null
  sourceContentId?: string | null
  contentId?: string | null
  overrides?: GenerateContentOverrides
  systemPrompt?: string
  temperature?: number
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
    slugSuggestion?: string
  }
}

interface FrontmatterResult {
  title: string
  description?: string
  slugSuggestion: string
  tags?: string[]
  status: typeof CONTENT_STATUSES[number]
  contentType: typeof CONTENT_TYPES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  sourceContentId?: string | null
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

const PLAN_SYSTEM_PROMPT = 'You are an editorial strategist planning SEO-friendly long-form content. Always respond with valid JSON.'
const SECTION_SYSTEM_PROMPT = 'You are an expert SEO content writer. Write the requested section content in MDX-compatible markdown. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'
const SECTION_PATCH_SYSTEM_PROMPT = 'You are revising a single section of an existing article. Only update that section using the author instructions and contextual transcript snippets. Do NOT include the section heading in your response - only write the body content. Respond with JSON.';
const PLAN_SECTION_LIMIT = 10
const SECTION_CONTEXT_LIMIT = 3

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
    if (match) {
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

const buildVirtualChunksFromText = (text: string, chunkSize = 1200, overlap = 200): PipelineChunk[] => {
  if (!text) {
    return []
  }

  const normalized = text.replace(/\s+/g, ' ').trim()
  const segments: PipelineChunk[] = []
  let index = 0
  let start = 0

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length)
    const slice = normalized.slice(start, end).trim()
    if (slice) {
      segments.push({
        chunkIndex: index,
        text: slice,
        textPreview: slice.slice(0, 280)
      })
      index += 1
    }

    if (end >= normalized.length) {
      break
    }

    start = Math.max(end - overlap, 0)
  }

  return segments
}

const gatherChunkPreview = (chunks: PipelineChunk[], maxChars = 4000) => {
  if (!chunks.length) {
    return 'No transcript snippets available.'
  }

  const parts: string[] = []
  let current = 0

  for (const chunk of chunks) {
    const snippet = chunk.textPreview || chunk.text.slice(0, 280)
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

  return parts.join('\n') || chunks[0].text.slice(0, 400)
}

const tokenize = (input: string) => {
  return (input || '')
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

const selectRelevantChunks = (chunks: PipelineChunk[], outline: OutlineSection) => {
  if (!chunks.length) {
    return []
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

const defaultPlan = (sourceTitle?: string): ContentPlanResult => ({
  outline: [
    { id: uuidv7(), index: 0, title: 'Introduction', type: 'intro', notes: `Set up the topic ${sourceTitle ? `based on ${sourceTitle}` : ''}`.trim() },
    { id: uuidv7(), index: 1, title: 'Key Ideas', type: 'body', notes: 'Summarize the most important concepts from the source material.' },
    { id: uuidv7(), index: 2, title: 'Actionable Takeaways', type: 'body', notes: 'Provide 3-5 actionable steps or insights for the reader.' },
    { id: uuidv7(), index: 3, title: 'Conclusion', type: 'conclusion', notes: 'Wrap up the narrative and reinforce the call to action.' }
  ],
  seo: {
    title: sourceTitle || 'New Codex Draft',
    description: 'Draft generated from a Codex pipeline.',
    keywords: [],
    slugSuggestion: slugifyTitle(sourceTitle || 'new-codex-draft')
  }
})

const generateContentPlan = async (params: {
  contentType: typeof CONTENT_TYPES[number]
  instructions?: string
  chunks: PipelineChunk[]
  sourceTitle?: string | null
}): Promise<ContentPlanResult> => {
  const preview = gatherChunkPreview(params.chunks)
  const prompt = [
    `We are planning a ${params.contentType}.`,
    params.sourceTitle ? `Source Title: ${params.sourceTitle}` : 'Source Title: Unknown',
    'Transcript highlights:',
    preview,
    params.instructions ? `Writer instructions: ${params.instructions}` : 'Writer instructions: none provided.',
    'Return JSON with shape {"outline": [{"id": string, "index": number, "title": string, "type": string, "notes": string? }], "seo": {"title": string, "description": string, "keywords": string[], "slugSuggestion": string, "schemaType": string? }}.',
    `Limit outline to ${PLAN_SECTION_LIMIT} sections.`
  ].join('\n\n')

  let plan: ContentPlanResult
  try {
    const raw = await callChatCompletions({
      systemPrompt: PLAN_SYSTEM_PROMPT,
      userPrompt: prompt
    })

    const parsed = parseJSONResponse<ContentPlanResult>(raw, 'content plan')
    const outline = Array.isArray(parsed.outline)
      ? parsed.outline.slice(0, PLAN_SECTION_LIMIT).map((item, idx) => ({
          id: item.id || uuidv7(),
          index: Number.isFinite(item.index) ? item.index : idx,
          title: item.title?.trim() || `Section ${idx + 1}`,
          type: item.type?.trim() || 'body',
          notes: item.notes?.trim() || undefined
        }))
      : []

    plan = {
      outline: outline.length ? outline : defaultPlan(params.sourceTitle ?? undefined).outline,
      seo: {
        title: parsed.seo?.title?.trim() || params.sourceTitle || 'New Codex Draft',
        description: parsed.seo?.description?.trim() || 'Draft generated from Codex pipeline.',
        keywords: Array.isArray(parsed.seo?.keywords) ? parsed.seo?.keywords : [],
        schemaType: parsed.seo?.schemaType?.trim(),
        slugSuggestion: slugifyTitle(parsed.seo?.slugSuggestion || parsed.seo?.title || params.sourceTitle || 'new-codex-draft')
      }
    }
  } catch (error) {
    console.error('Failed to create structured plan, falling back to defaults', { error })
    plan = defaultPlan(params.sourceTitle ?? undefined)
  }

  return plan
}

const buildFrontmatterFromPlan = (params: {
  plan: ContentPlanResult
  overrides?: GenerateContentOverrides
  existingContent?: typeof schema.content.$inferSelect | null
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}): FrontmatterResult => {
  const { plan, overrides, existingContent, sourceContent } = params

  const resolvedTitle = overrides?.title?.trim() || plan.seo.title || existingContent?.title || sourceContent?.title || 'New Codex Draft'
  const slugInput = overrides?.slug?.trim() || plan.seo.slugSuggestion || resolvedTitle

  const statusCandidate = overrides?.status && CONTENT_STATUSES.includes(overrides.status)
    ? overrides.status
    : (existingContent?.status ?? 'draft')

  const contentTypeCandidate = overrides?.contentType && CONTENT_TYPES.includes(overrides.contentType)
    ? overrides.contentType
    : (existingContent?.contentType ?? 'blog_post')

  return {
    title: resolvedTitle,
    description: plan.seo.description || sourceContent?.metadata?.description || undefined,
    slugSuggestion: slugifyTitle(slugInput || resolvedTitle),
    tags: plan.seo.keywords,
    status: statusCandidate,
    contentType: contentTypeCandidate,
    primaryKeyword: overrides?.primaryKeyword ?? existingContent?.primaryKeyword ?? plan.seo.keywords?.[0] ?? null,
    targetLocale: overrides?.targetLocale ?? existingContent?.targetLocale ?? null,
    sourceContentId: sourceContent?.id ?? existingContent?.sourceContentId ?? null
  }
}

const buildFrontmatterFromVersion = (params: {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect | null
}): FrontmatterResult => {
  const versionFrontmatter = params.version?.frontmatter || {}
  const resolvedTitle = versionFrontmatter.title || params.content.title || 'New Codex Draft'
  const slugInput = versionFrontmatter.slug || params.content.slug || resolvedTitle
  const statusCandidate = versionFrontmatter.status && CONTENT_STATUSES.includes(versionFrontmatter.status)
    ? versionFrontmatter.status
    : (params.content.status ?? 'draft')
  const contentTypeCandidate = versionFrontmatter.contentType && CONTENT_TYPES.includes(versionFrontmatter.contentType)
    ? versionFrontmatter.contentType
    : (params.content.contentType ?? 'blog_post')

  return {
    title: resolvedTitle,
    description: versionFrontmatter.description,
    slugSuggestion: slugifyTitle(slugInput || resolvedTitle),
    tags: Array.isArray(versionFrontmatter.tags) ? versionFrontmatter.tags : undefined,
    status: statusCandidate,
    contentType: contentTypeCandidate,
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
}): Promise<GeneratedSection[]> => {
  const sections: GeneratedSection[] = []

  for (const item of params.outline) {
    const relevantChunks = selectRelevantChunks(params.chunks, item)
    const contextBlock = relevantChunks.length
      ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 600)}`).join('\n\n')
      : 'No transcript context available.'

    const prompt = [
      `Section title: ${item.title}`,
      `Section type: ${item.type}`,
      item.notes ? `Plan notes: ${item.notes}` : 'Plan notes: none.',
      `Frontmatter: ${JSON.stringify({
        title: params.frontmatter.title,
        description: params.frontmatter.description,
        tags: params.frontmatter.tags,
        contentType: params.frontmatter.contentType
      })}`,
      params.instructions ? `Additional voice instructions: ${params.instructions}` : 'Additional voice instructions: default Codex editorial voice.',
      'Transcript context to ground this section:',
      contextBlock,
      'Respond with JSON {"body": string, "summary": string?}. "body" must include only the prose content for this section - do NOT include the section heading or title, as it will be added automatically.'
    ].join('\n\n')

    try {
      const raw = await callChatCompletions({
        systemPrompt: SECTION_SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: params.temperature
      })

      const parsed = parseJSONResponse<{ body?: string, body_mdx?: string, summary?: string }>(raw, `section ${item.title}`)
      const body = (parsed.body ?? parsed.body_mdx ?? '').trim()
      if (!body) {
        continue
      }

      const headingLevel = item.type === 'subsection' ? 3 : 2
      const anchor = slugifyTitle(item.title || `section-${item.index + 1}`)

      sections.push({
        id: item.id || uuidv7(),
        index: item.index ?? sections.length,
        type: item.type || 'body',
        title: item.title || `Section ${sections.length + 1}`,
        level: headingLevel,
        anchor,
        body,
        summary: parsed.summary?.trim() || null,
        wordCount: computeWordCount(body),
        meta: {
          planType: item.type,
          notes: item.notes || null,
          sourceChunks: relevantChunks.map(chunk => chunk.chunkIndex)
        }
      })
    } catch (error) {
      console.error('Failed to generate section', { sectionTitle: item.title, error })
    }
  }

  if (!sections.length) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to generate any sections from the provided plan'
    })
  }

  return sections.sort((a, b) => a.index - b.index)
}

const assembleMarkdownFromSections = (params: {
  frontmatter: FrontmatterResult
  sections: GeneratedSection[]
}) => {
  const ordered = [...params.sections].sort((a, b) => a.index - b.index)
  let markdown = `# ${params.frontmatter.title}\n\n`
  let currentOffset = markdown.length

  const sectionsWithOffsets = ordered.map(section => {
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

  markdown = markdown.trim() + '\n'

  return {
    markdown,
    sections: sectionsWithOffsets
  }
}

const buildAssetsMeta = (sourceContent?: typeof schema.sourceContent.$inferSelect | null) => {
  return {
    generator: {
      engine: 'codex-pipeline',
      generatedAt: new Date().toISOString(),
      stages: ['plan', 'frontmatter', 'sections']
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

const buildPatchAssets = (
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

const fetchOrCreateChunks = async (
  db: NodePgDatabase<typeof schema>,
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  fallbackText: string | null
): Promise<PipelineChunk[]> => {
  if (!sourceContent?.id) {
    return fallbackText ? buildVirtualChunksFromText(fallbackText) : []
  }

  let chunks = await db
    .select()
    .from(schema.chunk)
    .where(eq(schema.chunk.sourceContentId, sourceContent.id))
    .orderBy(asc(schema.chunk.chunkIndex))

  if (chunks.length === 0 && sourceContent.sourceText) {
    await chunkSourceContentText({ db, sourceContent })
    chunks = await db
      .select()
      .from(schema.chunk)
      .where(eq(schema.chunk.sourceContentId, sourceContent.id))
      .orderBy(asc(schema.chunk.chunkIndex))
  }

  if (chunks.length === 0) {
    return fallbackText ? buildVirtualChunksFromText(fallbackText) : []
  }

  return chunks.map(item => ({
    chunkIndex: item.chunkIndex,
    text: item.text,
    textPreview: item.textPreview ?? item.text.slice(0, 280)
  }))
}

export const generateContentDraft = async (
  db: NodePgDatabase<typeof schema>,
  input: GenerateContentInput
): Promise<GenerateContentResult> => {
  const {
    organizationId,
    userId,
    text,
    sourceContentId,
    contentId,
    overrides,
    systemPrompt,
    temperature
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

  const explicitText = typeof text === 'string' && text.trim().length > 0 ? text.trim() : null
  const sourceText = typeof sourceContent?.sourceText === 'string' && sourceContent.sourceText.trim().length > 0
    ? sourceContent.sourceText.trim()
    : null

  const inputText = explicitText || sourceText

  if (!inputText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'text or sourceContentId with source_text is required'
    })
  }

  const chunks = await fetchOrCreateChunks(db, sourceContent, inputText)

  const contentType = overrides?.contentType && CONTENT_TYPES.includes(overrides.contentType)
    ? overrides.contentType
    : (existingContent?.contentType ?? 'blog_post')

  const plan = await generateContentPlan({
    contentType,
    instructions: systemPrompt,
    chunks,
    sourceTitle: sourceContent?.title ?? existingContent?.title ?? null
  })

  const frontmatter = buildFrontmatterFromPlan({
    plan,
    overrides,
    existingContent,
    sourceContent
  })

  const sections = await generateSectionsFromOutline({
    outline: plan.outline,
    frontmatter,
    chunks,
    instructions: systemPrompt,
    temperature
  })

  const assembled = assembleMarkdownFromSections({
    frontmatter,
    sections
  })

  const resolvedSourceContentId = frontmatter.sourceContentId ?? sourceContent?.id ?? null
  const selectedStatus = frontmatter.status
  const selectedContentType = frontmatter.contentType
  const primaryKeyword = frontmatter.primaryKeyword ?? null
  const targetLocale = frontmatter.targetLocale ?? null

  const assets = buildAssetsMeta(sourceContent)
  const seoSnapshot = {
    plan: plan.seo,
    primaryKeyword,
    targetLocale,
    contentType: selectedContentType
  }

  const result = await db.transaction(async (tx) => {
    let contentRecord = existingContent
    let slug = existingContent?.slug
    const baseSlugInput = overrides?.slug || frontmatter.slugSuggestion || frontmatter.title

    if (!contentRecord) {
      let slugCandidate = await ensureUniqueContentSlug(tx, organizationId, baseSlugInput)
      let createdContent: typeof schema.content.$inferSelect | null = null
      let attempt = 0
      const maxAttempts = 5

      while (!createdContent && attempt < maxAttempts) {
        try {
          const [inserted] = await tx
            .insert(schema.content)
            .values({
              id: uuidv7(),
              organizationId,
              createdByUserId: userId,
              sourceContentId: resolvedSourceContentId,
              title: frontmatter.title,
              slug: slugCandidate,
              status: selectedStatus,
              primaryKeyword,
              targetLocale,
              contentType: selectedContentType,
              currentVersionId: null
            })
            .returning()

          createdContent = inserted
        } catch (error: any) {
          if (error?.code === '23505') {
            attempt += 1
            slugCandidate = await ensureUniqueContentSlug(
              tx,
              organizationId,
              `${baseSlugInput}-${Math.random().toString(36).slice(2, 6)}`
            )
            continue
          }
          throw error
        }
      }

      if (!createdContent) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Unable to allocate a unique slug for this content'
        })
      }

      slug = createdContent.slug
      contentRecord = createdContent
    } else {
      slug = contentRecord.slug

      const shouldUpdateSource = resolvedSourceContentId !== contentRecord.sourceContentId
      const shouldUpdate =
        frontmatter.title !== contentRecord.title ||
        selectedStatus !== contentRecord.status ||
        primaryKeyword !== contentRecord.primaryKeyword ||
        targetLocale !== contentRecord.targetLocale ||
        shouldUpdateSource ||
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
            contentType: selectedContentType,
            updatedAt: new Date()
          })
          .where(eq(schema.content.id, contentRecord.id))
          .returning()

        contentRecord = updatedContent
      }
    }

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
          status: selectedStatus,
          contentType: selectedContentType,
          sourceContentId: resolvedSourceContentId,
          primaryKeyword,
          targetLocale
        },
        bodyMdx: assembled.markdown,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.id))
      .returning()

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
    markdown: assembled.markdown,
    meta
  }
}

export const patchContentSection = async (
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

  if (!record?.content) {
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

  const normalizedSections = normalizeStoredSections(
    record.version.sections,
    record.version.bodyMdx ?? null
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
    content: record.content,
    version: record.version
  })

  const chunks = await fetchOrCreateChunks(
    db,
    record.sourceContent ?? null,
    record.sourceContent?.sourceText ?? null
  )

  const relevantChunks = selectRelevantChunks(chunks, {
    id: targetSection.id,
    index: targetSection.index,
    title: targetSection.title,
    type: targetSection.type,
    notes: trimmedInstructions
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
      primaryKeyword: frontmatter.primaryKeyword,
      targetLocale: frontmatter.targetLocale
    })}`,
    'Transcript context to ground this update:',
    contextBlock,
    'Respond with JSON {"body": string, "summary": string?}. Rewrite only this section content - do NOT include the section heading or title, as it will be added automatically.'
  ].join('\n\n')

  const raw = await callChatCompletions({
    systemPrompt: SECTION_PATCH_SYSTEM_PROMPT,
    userPrompt: prompt,
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

  const updatedSections = normalizedSections.map(section => {
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

  const assembled = assembleMarkdownFromSections({
    frontmatter,
    sections: updatedSections
  })

  const slug = record.version.frontmatter?.slug || record.content.slug
  const assets = buildPatchAssets(record.sourceContent ?? null, targetSection.id)
  const previousSeoSnapshot = record.version.seoSnapshot ?? {}
  const seoSnapshot = {
    ...previousSeoSnapshot,
    primaryKeyword: frontmatter.primaryKeyword,
    targetLocale: frontmatter.targetLocale,
    contentType: frontmatter.contentType,
    lastPatchedSectionId: targetSection.id,
    patchedAt: new Date().toISOString()
  }

  const result = await db.transaction(async (tx) => {
    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, record.content.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: record.content.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: frontmatter.title,
          description: frontmatter.description ?? record.version.frontmatter?.description,
          slug,
          tags: frontmatter.tags,
          status: frontmatter.status,
          contentType: frontmatter.contentType,
          sourceContentId: frontmatter.sourceContentId,
          primaryKeyword: frontmatter.primaryKeyword,
          targetLocale: frontmatter.targetLocale
        },
        bodyMdx: assembled.markdown,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, record.content.id))
      .returning()

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown: assembled.markdown,
    section: {
      id: targetSection.id,
      title: targetSection.title,
      index: targetSection.index
    }
  }
}
