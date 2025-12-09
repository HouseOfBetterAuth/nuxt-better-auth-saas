import type { ContentChunk } from './types'
import { createError } from 'h3'

const BASE_SCHEMA_TYPE = 'BlogPosting'

export const normalizeContentSchemaTypes = (
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

export const normalizeContentKeywords = (value?: string[] | null) => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(keyword => (typeof keyword === 'string' ? keyword.trim() : ''))
    .filter((keyword): keyword is string => Boolean(keyword))
}

export const parseAIResponseAsJSON = <T>(raw: string, label: string): T => {
  const trimmed = raw.trim()
  const tryParse = (value: string) => {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  let parsed = tryParse(trimmed)

  if (parsed === null) {
    const match = trimmed.match(/```json([\s\S]*?)```/i)
    if (match && match[1]) {
      parsed = tryParse(match[1])
    }
  }

  if (parsed === null) {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to parse ${label} response from AI`
    })
  }

  return parsed
}

export const tokenizeTextForSearch = (input: string) => {
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

export const calculateChunkRelevanceScore = (chunk: ContentChunk, tokens: string[]) => {
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

export const countWords = (value: string) => {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .length
}

/**
 * Estimates token count for text using GPT model approximation
 *
 * Approximation: ~4 characters per token for English text
 * This is a standard approximation for GPT models (GPT-3.5, GPT-4)
 *
 * @param text - Text to count tokens for
 * @returns Estimated token count
 */
export const estimateTokenCount = (text: string): number => {
  if (!text || !text.trim()) {
    return 0
  }
  // GPT models: ~4 characters per token on average for English text
  // This is a reasonable approximation without a full tokenizer
  return Math.ceil(text.length / 4)
}

/**
 * Converts token count to approximate character count
 *
 * @param tokens - Number of tokens
 * @returns Approximate character count
 */
export const tokensToChars = (tokens: number): number => {
  return tokens * 4
}

/**
 * Converts character count to approximate token count
 *
 * @param chars - Number of characters
 * @returns Approximate token count
 */
export const charsToTokens = (chars: number): number => {
  return Math.ceil(chars / 4)
}

export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
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

export const isValidContentFrontmatter = (value: unknown): value is import('./types').ContentFrontmatter => {
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
    && data.schemaTypes.every(t => typeof t === 'string')
}
