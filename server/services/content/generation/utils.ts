import { createError } from 'h3'
import type { ContentChunk } from './types'

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
}
