import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { createChunksFromSourceContentText } from '~~/server/services/sourceContent/chunkSourceContent'

export const MANUAL_TRANSCRIPT_SOURCE_TYPE = 'manual_transcript'

interface CreateManualContextOptions {
  db: NodePgDatabase<typeof schema>
  organizationId: string
  userId: string
  context: string
  title?: string | null
  metadata?: Record<string, any> | null
  mode?: 'chat' | 'agent'
  onProgress?: (message: string) => Promise<void> | void
}

/**
 * Creates source content from raw context text
 *
 * @param options - Options for creating source content from context
 * @param options.db - Database instance
 * @param options.organizationId - Organization ID
 * @param options.userId - User ID
 * @param options.context - Context text content
 * @param options.title - Optional title for the source content
 * @param options.metadata - Optional metadata object
 * @param options.mode - Chat mode ('chat' or 'agent')
 * @param options.onProgress - Optional progress callback
 * @returns Created source content record
 */
export const createSourceContentFromContext = async ({
  db,
  organizationId,
  userId,
  context,
  title,
  metadata,
  mode,
  onProgress
}: CreateManualContextOptions) => {
  // Enforce agent mode for writes
  if (mode === 'chat') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Writes are not allowed in chat mode'
    })
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`🚀 [MANUAL_CONTEXT] Starting manual context creation...`)
    console.log(`🚀 [MANUAL_CONTEXT] Context length: ${context.length} characters`)
  }

  const normalizedContext = context.trim()
  if (!normalizedContext) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Context cannot be empty'
    })
  }

  await onProgress?.('Saving context...')

  const result = await db.transaction(async (tx) => {
    const sourceContent = await upsertSourceContent(tx, {
      organizationId,
      userId,
      sourceType: MANUAL_TRANSCRIPT_SOURCE_TYPE,
      externalId: uuidv7(),
      title: title ?? null,
      sourceText: normalizedContext,
      mode,
      metadata: {
        ...(metadata ?? {}),
        origin: metadata?.origin ?? 'context',
        ingestMethod: metadata?.ingestMethod ?? MANUAL_TRANSCRIPT_SOURCE_TYPE
      },
      ingestStatus: 'ingested'
    })

    if (!sourceContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to store context source content'
      })
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ [MANUAL_CONTEXT] Created sourceContent: ${sourceContent.id}`)
      console.log(`🔧 [MANUAL_CONTEXT] About to call chunkSourceContentText...`)
    }

    await onProgress?.('Chunking context into searchable segments...')

    try {
      await createChunksFromSourceContentText({
        db: tx,
        sourceContent,
        onProgress: async (progress) => {
          if (progress.includes('embedding') || progress.includes('vector')) {
            await onProgress?.(progress)
          }
        }
      })
    } catch (error) {
      console.error(`❌ [MANUAL_CONTEXT] Chunking failed for: ${sourceContent.id}`, error)
      throw error
    }

    await onProgress?.('Generating embeddings for semantic search...')

    if (process.env.NODE_ENV === 'development') {
      console.log(`🎉 [MANUAL_CONTEXT] Completed chunking for: ${sourceContent.id}`)
    }
    return sourceContent
  })

  await onProgress?.('✓ Context processed and ready!')

  return result
}
