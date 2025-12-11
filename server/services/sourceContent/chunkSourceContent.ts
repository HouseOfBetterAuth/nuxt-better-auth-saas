/**
 * Source Content Chunking Service
 *
 * Handles splitting source text into chunks, generating embeddings, and storing vectors.
 *
 * Note: This service works with Cloudflare Vectorize but metadata filtering has limitations.
 * See docs/VECTORIZE_METADATA_ISSUE.md for full details on the metadata issue.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { estimateTokenCount, tokensToChars } from '~~/server/services/content/generation/utils'

interface ChunkSourceContentOptions {
  db: NodePgDatabase<typeof schema>
  sourceContent: typeof schema.sourceContent.$inferSelect
  chunkSize?: number // Size of each chunk in tokens (default: 600)
  chunkOverlap?: number // Overlap between chunks in tokens (default: 75)
  onProgress?: (message: string) => Promise<void> | void
}

// Default chunking configuration (token-based)
const DEFAULT_CHUNK_SIZE_TOKENS = 600 // ~2400 characters
const DEFAULT_CHUNK_OVERLAP_TOKENS = 75 // ~300 characters
const MAX_CHUNK_SIZE_TOKENS = 2000 // ~8000 characters

/**
 * Finds the nearest paragraph boundary before or at the target position
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
 * Creates chunks from source content text for RAG (Retrieval Augmented Generation)
 *
 * Uses token-based chunking (600 tokens ≈ 2400 characters) with semantic
 * boundary support to respect paragraph and sentence boundaries.
 *
 * @param options - Options for chunking source content
 * @param options.db - Database instance
 * @param options.sourceContent - Source content record to chunk
 * @param options.chunkSize - Size of each chunk in tokens (default: 600)
 * @param options.chunkOverlap - Overlap between chunks in tokens (default: 75)
 * @param options.onProgress - Optional progress callback
 * @returns Array of created chunk records
 */
export async function createChunksFromSourceContentText({
  db,
  sourceContent,
  chunkSize,
  chunkOverlap,
  onProgress
}: ChunkSourceContentOptions) {
  if (!sourceContent.sourceText || !sourceContent.sourceText.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Source text is required to create chunks.'
    })
  }

  // Determine chunk size and overlap (always token-based)
  const targetChunkSizeTokens = (chunkSize !== undefined && Number.isFinite(chunkSize)) ? Math.floor(chunkSize as number) : DEFAULT_CHUNK_SIZE_TOKENS
  const targetOverlapTokens = (chunkOverlap !== undefined && Number.isFinite(chunkOverlap)) ? Math.floor(chunkOverlap as number) : DEFAULT_CHUNK_OVERLAP_TOKENS

  if (targetChunkSizeTokens <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkSize must be a positive integer greater than zero.'
    })
  }

  if (targetChunkSizeTokens > MAX_CHUNK_SIZE_TOKENS) {
    throw createError({
      statusCode: 400,
      statusMessage: `chunkSize cannot exceed ${MAX_CHUNK_SIZE_TOKENS} tokens (approximately ${tokensToChars(MAX_CHUNK_SIZE_TOKENS)} characters).`
    })
  }

  if (targetOverlapTokens < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkOverlap must be an integer greater than or equal to zero.'
    })
  }

  if (targetOverlapTokens >= targetChunkSizeTokens) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkOverlap must be smaller than chunkSize.'
    })
  }

  // Convert token sizes to character sizes for actual chunking
  const effectiveSize = tokensToChars(targetChunkSizeTokens)
  const overlap = tokensToChars(targetOverlapTokens)
  const step = Math.max(1, effectiveSize - overlap)

  // Normalize text (collapse whitespace but preserve paragraph breaks)
  const text = sourceContent.sourceText.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim()

  const segments: Array<typeof schema.chunk.$inferInsert> = []
  let index = 0
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + effectiveSize, text.length)

    // Try to find semantic boundary (paragraph or sentence break)
    if (end < text.length) {
      const maxLookback = Math.floor(effectiveSize * 0.2) // Look back up to 20% of chunk size
      const boundaryPos = findParagraphBoundary(text, end, maxLookback)

      // Use boundary if it's within reasonable range (not too far back)
      if (boundaryPos >= start + (effectiveSize * 0.7)) {
        end = boundaryPos
      }
    }

    const segment = text.slice(start, end).trim()

    if (segment) {
      // Verify token count is approximately correct
      const estimatedTokens = estimateTokenCount(segment)
      // If chunk is significantly over target, try to trim at sentence boundary
      if (estimatedTokens > targetChunkSizeTokens * 1.2 && end < text.length) {
        const trimmedEnd = findParagraphBoundary(text, start + effectiveSize, Math.floor(effectiveSize * 0.3))
        if (trimmedEnd > start) {
          const trimmedSegment = text.slice(start, trimmedEnd).trim()
          if (trimmedSegment && estimateTokenCount(trimmedSegment) <= targetChunkSizeTokens * 1.1) {
            end = trimmedEnd
            const finalSegment = trimmedSegment
            segments.push({
              id: undefined,
              organizationId: sourceContent.organizationId,
              sourceContentId: sourceContent.id,
              chunkIndex: index,
              startChar: start,
              endChar: end,
              text: finalSegment,
              textPreview: finalSegment.slice(0, 200),
              embedding: null,
              metadata: null
            })
            index += 1
            start = Math.max(end - overlap, start + step)
            continue
          }
        }
      }

      segments.push({
        id: undefined,
        organizationId: sourceContent.organizationId,
        sourceContentId: sourceContent.id,
        chunkIndex: index,
        startChar: start,
        endChar: end,
        text: segment,
        textPreview: segment.slice(0, 200),
        embedding: null,
        metadata: null
      })
      index += 1
    }

    if (end >= text.length) {
      break
    }

    start = Math.max(end - overlap, start + step)
  }

  if (!segments.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to generate chunks from the provided text.'
    })
  }

  await onProgress?.(`Created ${segments.length} chunk${segments.length > 1 ? 's' : ''} from context`)

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.chunk)
      .where(eq(schema.chunk.sourceContentId, sourceContent.id))

    await tx.insert(schema.chunk).values(segments)
  })

  return segments
}
