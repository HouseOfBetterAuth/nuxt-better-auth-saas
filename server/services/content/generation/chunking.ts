import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentChunk, ContentOutlineSection } from './types'
import { asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
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
import {
  calculateChunkRelevanceScore,
  calculateCosineSimilarity,
  estimateTokenCount,
  tokenizeTextForSearch,
  tokensToChars
} from './utils'

const SECTION_CONTEXT_LIMIT = 3

// Default chunking configuration (token-based)
export const DEFAULT_CHUNK_SIZE_TOKENS = 600 // ~2400 characters
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 75 // ~300 characters

/**
 * Finds the nearest paragraph boundary before or at the target position
 *
 * @param text - Text to search in
 * @param targetPos - Target character position
 * @param maxLookback - Maximum characters to look back for a boundary
 * @returns Position of nearest paragraph boundary, or targetPos if none found
 */
function findParagraphBoundary(text: string, targetPos: number, maxLookback: number): number {
  const lookbackStart = Math.max(0, targetPos - maxLookback)
  const searchText = text.slice(lookbackStart, targetPos + 1)

  // Look for double newlines (paragraph breaks) first
  const lastDoubleNewline = searchText.lastIndexOf('\n\n')
  if (lastDoubleNewline >= 0) {
    return lookbackStart + lastDoubleNewline + 2
  }

  // Look for single newlines
  const lastNewline = searchText.lastIndexOf('\n')
  if (lastNewline >= 0) {
    return lookbackStart + lastNewline + 1
  }

  // Look for sentence endings (period, exclamation, question mark followed by space)
  const sentenceMatches = [...searchText.matchAll(/[.!?]\s/g)]
  if (sentenceMatches.length > 0) {
    const lastMatch = sentenceMatches[sentenceMatches.length - 1]
    return lookbackStart + (lastMatch.index ?? 0) + 2
  }

  return targetPos
}

/**
 * Creates text chunks using token-based chunking with semantic boundary support
 *
 * @param text - Text to chunk
 * @param chunkSizeTokens - Target chunk size in tokens (default: 600)
 * @param overlapTokens - Overlap between chunks in tokens (default: 75)
 * @returns Array of content chunks
 */
export const createTextChunks = (
  text: string,
  chunkSizeTokens: number = DEFAULT_CHUNK_SIZE_TOKENS,
  overlapTokens: number = DEFAULT_CHUNK_OVERLAP_TOKENS
): ContentChunk[] => {
  if (!text) {
    return []
  }

  // Convert token-based sizes to character-based for actual chunking
  const chunkSizeChars = tokensToChars(chunkSizeTokens)
  const overlapChars = tokensToChars(overlapTokens)

  const effectiveChunkSize = Number.isFinite(chunkSizeChars) ? Math.max(1, Math.floor(chunkSizeChars)) : tokensToChars(DEFAULT_CHUNK_SIZE_TOKENS)
  const normalizedOverlap = Number.isFinite(overlapChars) ? Math.floor(overlapChars) : 0
  const effectiveOverlap = Math.min(Math.max(normalizedOverlap, 0), effectiveChunkSize - 1)
  const step = Math.max(1, effectiveChunkSize - effectiveOverlap)

  // Normalize text (collapse whitespace but preserve paragraph breaks)
  const normalized = text.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim()
  const segments: ContentChunk[] = []
  let index = 0
  let start = 0

  while (start < normalized.length) {
    let end = Math.min(start + effectiveChunkSize, normalized.length)

    // Try to find semantic boundary (paragraph or sentence break)
    if (end < normalized.length) {
      const maxLookback = Math.floor(effectiveChunkSize * 0.2) // Look back up to 20% of chunk size
      const boundaryPos = findParagraphBoundary(normalized, end, maxLookback)

      // Use boundary if it's within reasonable range (not too far back)
      if (boundaryPos >= start + (effectiveChunkSize * 0.7)) {
        end = boundaryPos
      }
    }

    const slice = normalized.slice(start, end).trim()
    if (slice) {
      // Verify token count is approximately correct
      const estimatedTokens = estimateTokenCount(slice)
      // If chunk is significantly over target, try to trim at sentence boundary
      if (estimatedTokens > chunkSizeTokens * 1.2 && end < normalized.length) {
        const trimmedEnd = findParagraphBoundary(normalized, start + effectiveChunkSize, Math.floor(effectiveChunkSize * 0.3))
        if (trimmedEnd > start) {
          const trimmedSlice = normalized.slice(start, trimmedEnd).trim()
          if (trimmedSlice && estimateTokenCount(trimmedSlice) <= chunkSizeTokens * 1.1) {
            end = trimmedEnd
            const finalSlice = trimmedSlice
            segments.push({
              chunkIndex: index,
              text: finalSlice,
              textPreview: finalSlice.slice(0, 280),
              sourceContentId: null,
              embedding: null
            })
            index += 1
            start = Math.max(end - effectiveOverlap, start + step)
            continue
          }
        }
      }

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

    start = Math.max(end - effectiveOverlap, start + step)
  }

  return segments
}

export const buildChunkPreviewText = (chunks: ContentChunk[], maxChars = 6000) => {
  if (!chunks.length) {
    return 'No context available.'
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

export const findRelevantChunksForSection = async (params: {
  chunks: ContentChunk[]
  outline: ContentOutlineSection
  organizationId: string
  sourceContentId?: string | null
}): Promise<ContentChunk[]> => {
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
        .filter((item): item is ContentChunk => Boolean(item))

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
        score: calculateCosineSimilarity(queryEmbedding!, chunk.embedding as number[])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SECTION_CONTEXT_LIMIT)

    if (scored.length && (scored[0]?.score ?? 0) > 0) {
      return scored.map(item => item.chunk)
    }
  }

  const tokens = tokenizeTextForSearch(`${outline.title} ${outline.notes ?? ''}`)
  const scored = chunks.map(chunk => ({ chunk, score: calculateChunkRelevanceScore(chunk, tokens) }))
  scored.sort((a, b) => b.score - a.score)

  const top = scored.filter(item => item.score > 0).slice(0, SECTION_CONTEXT_LIMIT)
  if (top.length > 0) {
    return top.map(item => item.chunk)
  }

  return scored.slice(0, SECTION_CONTEXT_LIMIT).map(item => item.chunk)
}

export const ensureSourceContentChunksExist = async (
  db: NodePgDatabase<typeof schema>,
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  fallbackText: string | null
): Promise<ContentChunk[]> => {
  if (!sourceContent?.id) {
    if (!fallbackText || !fallbackText.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Source content is required. Provide a sourceContentId or fallback text.'
      })
    }
    // Use token-based chunking (600 tokens, 75 overlap)
    const virtualChunks = createTextChunks(fallbackText, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)
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
