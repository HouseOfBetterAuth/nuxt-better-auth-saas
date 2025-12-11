import type { GenerationMode } from './context'
import type { ContentChunk, ContentFrontmatter, ContentOutlineSection, ContentSection } from './types'
import { createError } from 'h3'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { slugifyTitle } from '~~/server/utils/content'
import { findRelevantChunksForSection } from './chunking'
import { countWords, parseAIResponseAsJSON } from './utils'

export const CONTENT_SECTION_SYSTEM_PROMPT = 'You are a skilled writer creating well-structured content. Write in MDX-compatible markdown. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'

export const CONTENT_SECTION_UPDATE_SYSTEM_PROMPT = 'You are revising a single section of an existing article. Only update that section using the author instructions and contextual snippets. Do NOT include the section heading in your response - only write the body content. Respond with JSON.'

export const MAX_SECTION_CONTEXT_CHUNKS = 3

export const generateContentSectionsFromOutline = async (params: {
  outline: ContentOutlineSection[]
  frontmatter: ContentFrontmatter
  chunks: ContentChunk[]
  instructions?: string
  temperature?: number
  organizationId: string
  sourceContentId?: string | null
  generationMode?: GenerationMode
  conversationContext?: string | null
  intentSummary?: string | null
}): Promise<ContentSection[]> => {
  const sections: ContentSection[] = []
  const mode = params.generationMode || 'context'

  for (const item of params.outline) {
    const relevantChunks = await findRelevantChunksForSection({
      chunks: params.chunks,
      outline: item,
      organizationId: params.organizationId,
      sourceContentId: params.sourceContentId
    })

    // Build context block based on mode
    let contextBlock: string
    let contextLabel: string
    let writingInstruction: string

    if (mode === 'conversation') {
      // Conversation-only mode: use conversation context
      contextBlock = params.conversationContext || 'No context available.'
      contextLabel = 'User Intent and Requirements:'
      writingInstruction = 'Write this section based on the user\'s intent and requirements from the conversation. Use general knowledge and best practices to create high-quality content that addresses the user\'s needs.'
    } else if (mode === 'hybrid') {
      // Hybrid mode: combine chunks and conversation context
      const chunkContext = relevantChunks.length
        ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 1200)}`).join('\n\n')
        : null
      const conversationContext = params.conversationContext || null

      if (chunkContext && conversationContext) {
        contextBlock = `Source Material:\n${chunkContext}\n\nUser Intent:\n${conversationContext}`
        contextLabel = 'Context:'
        writingInstruction = 'Write this section using both the provided source material and the user\'s intent from the conversation. Ground your writing in the source material while incorporating the user\'s requirements and preferences.'
      } else if (chunkContext) {
        contextBlock = chunkContext
        contextLabel = 'Context:'
        writingInstruction = 'Write this section based on the provided context.'
      } else if (conversationContext) {
        contextBlock = conversationContext
        contextLabel = 'User Intent:'
        writingInstruction = 'Write this section based on the user\'s intent from the conversation.'
      } else {
        contextBlock = 'No context available.'
        contextLabel = 'Context:'
        writingInstruction = 'Write this section based on general knowledge and best practices.'
      }
    } else {
      // Context-only mode: use chunks (existing behavior)
      contextBlock = relevantChunks.length
        ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 1200)}`).join('\n\n')
        : 'No context available.'
      contextLabel = 'Context:'
      writingInstruction = 'Write this section based on the provided context.'
    }

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
      params.instructions ? `Writer instructions: ${params.instructions}` : null,
      params.intentSummary ? `Intent summary:\n${params.intentSummary}` : null,
      contextLabel,
      contextBlock,
      `${writingInstruction} Respond with JSON {"body": string, "summary": string?}. "body" must include only the prose content for this section - do NOT include the section heading or title, as it will be added automatically.`
    ].filter(Boolean).join('\n\n')

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
