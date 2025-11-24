import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'

export const INGEST_STATUSES = ['pending', 'ingested', 'failed'] as const

export interface SourceContentUpsertInput {
  organizationId: string
  userId: string
  sourceType: string
  externalId?: string | null
  title?: string | null
  sourceText?: string | null
  metadata?: Record<string, any> | null
  ingestStatus?: typeof INGEST_STATUSES[number]
}

export const upsertSourceContent = async (
  db: NodePgDatabase<typeof schema>,
  input: SourceContentUpsertInput
) => {
  if (!input.sourceType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType is required'
    })
  }

  const ingestStatus = input.ingestStatus && INGEST_STATUSES.includes(input.ingestStatus)
    ? input.ingestStatus
    : 'pending'

  const payload = {
    title: typeof input.title === 'string' ? input.title : null,
    sourceText: typeof input.sourceText === 'string' ? input.sourceText : null,
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? input.metadata : null,
    ingestStatus
  }

  const [result] = await db
    .insert(schema.sourceContent)
    .values({
      id: uuidv7(),
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      sourceType: input.sourceType,
      externalId: input.externalId ?? null,
      ...payload
    })
    .onConflictDoUpdate({
      target: [
        schema.sourceContent.organizationId,
        schema.sourceContent.sourceType,
        schema.sourceContent.externalId
      ],
      set: {
        ...payload,
        updatedAt: new Date()
      }
    })
    .returning()

  return result
}
