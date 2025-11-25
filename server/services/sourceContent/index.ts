import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { createError } from 'h3'
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

  // Run select/update/insert flow inside a single transaction to reduce race conditions
  return db.transaction(async (tx) => {
    // Partial unique indexes with WHERE clauses can't be used directly in ON CONFLICT
    // We need to check if a record exists first, then update or insert within the same transaction
    const existing = await tx.query.sourceContent.findFirst({
      where: (sourceContent, { eq, and, isNull, isNotNull }) => {
        const conditions = [
          eq(sourceContent.organizationId, input.organizationId),
          eq(sourceContent.sourceType, input.sourceType)
        ]

        if (input.externalId) {
          conditions.push(eq(sourceContent.externalId, input.externalId))
          conditions.push(isNotNull(sourceContent.externalId))
        } else {
          conditions.push(isNull(sourceContent.externalId))
        }

        return and(...conditions)
      }
    })

    if (existing) {
      // Update existing record
      const [updated] = await tx
        .update(schema.sourceContent)
        .set(updatePayload)
        .where(sql`${schema.sourceContent.id} = ${existing.id}`)
        .returning()

      return updated
    }

    // Insert new record
    const [inserted] = await tx
      .insert(schema.sourceContent)
      .values(insertValues)
      .returning()

    return inserted
  })
}
