import type { ContentChunk, ContentFrontmatter, ContentOutlineSection, ContentSection } from './types'
import { createError } from 'h3'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { slugifyTitle } from '~~/server/utils/content'
import { findRelevantChunksForSection } from './chunking'
import { countWords, parseAIResponseAsJSON } from './utils'

export const CONTENT_SECTION_SYSTEM_PROMPT = 'You are a skilled writer who preserves the original author\'s unique voice, personality, and authentic expressions while creating well-structured content. Maintain casual language, personal anecdotes, specific details, and the authentic tone from the source material. Write in MDX-compatible markdown. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'

export const CONTENT_SECTION_UPDATE_SYSTEM_PROMPT = 'You are revising a single section of an existing article. Only update that section using the author instructions and contextual transcript snippets. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'

export const MAX_SECTION_CONTEXT_CHUNKS = 3

export const generateContentSectionsFromOutline = async (params: {
  outline: ContentOutlineSection[]
  frontmatter: ContentFrontmatter
  chunks: ContentChunk[]
  instructions?: string
  temperature?: number
  organizationId: string
  sourceContentId?: string | null
}): Promise<ContentSection[]> => {
  const sections: ContentSection[] = []

  for (const item of params.outline) {
    const relevantChunks = await findRelevantChunksForSection({
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
        { role: 'system', content: CONTENT_SECTION_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature
    })

    const parsed = parseAIResponseAsJSON<{ body?: string, body_mdx?: string, summary?: string }>(raw, `section ${item.title}`)

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
      wordCount: countWords(body),
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

export const extractSectionContent = (
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

export const normalizeContentSections = (
  sectionsData: any,
  bodyMdx: string | null
): ContentSection[] => {
  if (!Array.isArray(sectionsData)) {
    return []
  }

  return sectionsData.map((section: Record<string, any>, idx: number) => {
    const id = section.id || section.section_id || `section-${idx}`
    const title = section.title || `Section ${idx + 1}`
    const body = extractSectionContent(section, bodyMdx)

    return {
      id,
      index: Number.isFinite(section.index) ? section.index : idx,
      type: section.type || section.meta?.planType || 'body',
      title,
      level: Number.isFinite(section.level) ? section.level : 2,
      anchor: section.anchor || slugifyTitle(title),
      body,
      summary: section.summary || section.meta?.summary || null,
      wordCount: Number.isFinite(section.wordCount) ? section.wordCount : countWords(body),
      meta: section.meta || {}
    }
  })
}
