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
import * as schema from '~~/server/database/schema'

interface ChunkSourceContentOptions {
  db: NodePgDatabase<typeof schema>
  sourceContent: typeof schema.sourceContent.$inferSelect
  chunkSize?: number
  chunkOverlap?: number
  onProgress?: (message: string) => Promise<void> | void
}

const DEFAULT_CHUNK_SIZE = 1200
const DEFAULT_CHUNK_OVERLAP = 200
const MAX_CHUNK_SIZE = 8000

/**
 * Creates chunks from source content text for RAG (Retrieval Augmented Generation)
 *
 * @param options - Options for chunking source content
 * @param options.db - Database instance
 * @param options.sourceContent - Source content record to chunk
 * @param options.chunkSize - Size of each chunk in characters (default: 1200)
 * @param options.chunkOverlap - Overlap between chunks in characters (default: 200)
 * @param options.onProgress - Optional progress callback
 * @returns Array of created chunk records
 */
export async function createChunksFromSourceContentText({
  db,
  sourceContent,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  onProgress
}: ChunkSourceContentOptions) {
  if (!sourceContent.sourceText || !sourceContent.sourceText.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Source text is required to create chunks.'
    })
  }

  const normalizedChunkSize = Number.isFinite(chunkSize) ? Math.floor(chunkSize) : Number.NaN
  if (!Number.isFinite(normalizedChunkSize) || normalizedChunkSize <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkSize must be a positive integer greater than zero.'
    })
  }

  if (normalizedChunkSize > MAX_CHUNK_SIZE) {
    throw createError({
      statusCode: 400,
      statusMessage: `chunkSize cannot exceed ${MAX_CHUNK_SIZE} characters.`
    })
  }

  const normalizedChunkOverlap = Number.isFinite(chunkOverlap) ? Math.floor(chunkOverlap) : Number.NaN
  if (!Number.isFinite(normalizedChunkOverlap) || normalizedChunkOverlap < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkOverlap must be an integer greater than or equal to zero.'
    })
  }

  if (normalizedChunkOverlap >= normalizedChunkSize) {
    throw createError({
      statusCode: 400,
      statusMessage: 'chunkOverlap must be smaller than chunkSize.'
    })
  }

  const text = sourceContent.sourceText.replace(/\s+/g, ' ').trim()

  const segments: Array<typeof schema.chunk.$inferInsert> = []
  const effectiveSize = normalizedChunkSize
  const overlap = normalizedChunkOverlap

  let index = 0
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + effectiveSize, text.length)
    const segment = text.slice(start, end).trim()

    if (segment) {
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

    start = Math.max(end - overlap, 0)
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
