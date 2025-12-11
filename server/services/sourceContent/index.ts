import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { validateEnum } from '~~/server/utils/validation'

export const INGEST_STATUSES = ['pending', 'processing', 'ingested', 'failed'] as const

export interface SourceContentUpsertInput {
  organizationId: string
  userId: string
  sourceType: string
  externalId?: string | null
  title?: string | null
  sourceText?: string | null
  metadata?: Record<string, any> | null
  ingestStatus?: typeof INGEST_STATUSES[number]
  mode?: 'chat' | 'agent'
}

export const upsertSourceContent = async (
  db: NodePgDatabase<typeof schema>,
  input: SourceContentUpsertInput
) => {
  // Enforce agent mode for writes
  if (input.mode === 'chat') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Writes are not allowed in chat mode'
    })
  }

  if (!input.sourceType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType is required'
    })
  }

  const ingestStatus = input.ingestStatus
    ? validateEnum(input.ingestStatus, INGEST_STATUSES, 'ingestStatus')
    : 'pending'

  const insertPayload: Record<string, any> = {
    ingestStatus
  }

  const updatePayload: Record<string, any> = {
    ingestStatus,
    updatedAt: new Date()
  }

  if (input.title !== undefined) {
    insertPayload.title = input.title
    updatePayload.title = input.title
  }

  if (input.sourceText !== undefined) {
    insertPayload.sourceText = input.sourceText
    updatePayload.sourceText = input.sourceText
  }

  if (input.metadata !== undefined) {
    insertPayload.metadata = input.metadata
    updatePayload.metadata = input.metadata
  }

  const insertValues = {
    id: uuidv7(),
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    sourceType: input.sourceType,
    externalId: input.externalId ?? null,
    ...insertPayload
  }

  // Use a single atomic INSERT ... ON CONFLICT DO UPDATE to avoid race conditions
  if (input.externalId != null) {
    const [row] = await db
      .insert(schema.sourceContent)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [
          schema.sourceContent.organizationId,
          schema.sourceContent.sourceType,
          schema.sourceContent.externalId
        ],
        targetWhere: sql`${schema.sourceContent.externalId} is not null`,
        set: updatePayload
      })
      .returning()

    return row
  }

  const [row] = await db
    .insert(schema.sourceContent)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [
        schema.sourceContent.organizationId,
        schema.sourceContent.sourceType
      ],
      targetWhere: sql`${schema.sourceContent.externalId} is null`,
      set: updatePayload
    })
    .returning()

  return row
}
