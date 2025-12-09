import type { CONTENT_TYPES } from '~~/server/utils/content'
import type { ContentChunk, ContentOutline } from './types'
import { createError } from 'h3'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { slugifyTitle } from '~~/server/utils/content'
import { buildChunkPreviewText } from './chunking'
import { normalizeContentSchemaTypes, parseAIResponseAsJSON } from './utils'

export const CONTENT_OUTLINE_SYSTEM_PROMPT = 'You are an editorial strategist creating well-structured articles. Always respond with valid JSON.'

export const MAX_OUTLINE_SECTIONS = 10

export const generateContentOutline = async (params: {
  contentType: typeof CONTENT_TYPES[number]
  instructions?: string
  chunks: ContentChunk[] | null
  sourceText?: string | null
  sourceTitle?: string | null
  conversationContext?: string | null
}): Promise<ContentOutline> => {
  const preview = params.chunks && params.chunks.length > 0
    ? buildChunkPreviewText(params.chunks)
    : (params.sourceText
        ? params.sourceText.slice(0, 6000) + (params.sourceText.length > 6000 ? '...' : '')
        : (params.conversationContext
            ? params.conversationContext.slice(0, 6000) + (params.conversationContext.length > 6000 ? '...' : '')
            : 'No context available.'))
  const prompt = [
    `Plan a ${params.contentType}.`,
    params.sourceTitle ? `Source Title: ${params.sourceTitle}` : 'Source Title: Unknown',
    'Context highlights:',
    preview,
    params.instructions ? `Writer instructions: ${params.instructions}` : null,
    'Create an outline that reflects the natural flow of the content. Return JSON with shape {"outline": [{"id": string, "index": number, "title": string, "type": string, "notes": string? }], "seo": {"title": string, "description": string, "keywords": string[], "slugSuggestion": string, "schemaTypes": string[] }}.',
    'Always include "BlogPosting" in schemaTypes, then append any additional schema.org types (e.g., Recipe, HowTo, FAQPage) when the content genuinely needs those structures.',
    `Limit outline to ${MAX_OUTLINE_SECTIONS} sections.`
  ].filter(Boolean).join('\n\n')

  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: CONTENT_OUTLINE_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7
  })

  const parsed = parseAIResponseAsJSON<ContentOutline>(raw, 'content plan')

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

  const outline = parsed.outline.slice(0, MAX_OUTLINE_SECTIONS).map((item, idx) => {
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

  const parsedSchemaTypes = normalizeContentSchemaTypes(parsed.seo?.schemaTypes, parsed.seo?.schemaType)

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

  const plan: ContentOutline = {
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
