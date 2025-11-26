import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { createError } from 'h3'
import * as schema from '~~/server/database/schema'

interface ChunkSourceContentOptions {
  db: NodePgDatabase<typeof schema>
  sourceContent: typeof schema.sourceContent.$inferSelect
  chunkSize?: number
  chunkOverlap?: number
}

const DEFAULT_CHUNK_SIZE = 1200
const DEFAULT_CHUNK_OVERLAP = 200

export async function chunkSourceContentText ({
  db,
  sourceContent,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP
}: ChunkSourceContentOptions) {
  if (!sourceContent.sourceText || !sourceContent.sourceText.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Source text is required to create chunks.'
    })
  }

  const text = sourceContent.sourceText.replace(/\s+/g, ' ').trim()

  await db
    .delete(schema.chunk)
    .where(eq(schema.chunk.sourceContentId, sourceContent.id))

  const segments: Array<typeof schema.chunk.$inferInsert> = []
  const effectiveSize = Math.max(chunkSize, 200)
  const overlap = Math.min(chunkOverlap, Math.floor(effectiveSize / 2))

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

    start = end - overlap
    if (start < 0) {
      start = 0
    }
  }

  if (!segments.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to generate transcript chunks from the provided text.'
    })
  }

  await db.insert(schema.chunk).values(segments)

  return segments
}
