import { relations, sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { organization, user } from './auth'

export const ingestStatusEnum = pgEnum('ingest_status', ['pending', 'ingested', 'failed'])

export const sourceContent = pgTable('source_content', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  externalId: text('external_id'),
  title: text('title'),
  sourceText: text('source_text'),
  metadata: jsonb('metadata').$type<Record<string, any> | null>().default(null),
  ingestStatus: ingestStatusEnum('ingest_status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
}, table => ({
  organizationIdx: index('source_content_organization_idx').on(table.organizationId),
  sourceTypeIdx: index('source_content_type_idx').on(table.sourceType),
  orgSourceExternalUnique: uniqueIndex('source_content_org_type_external_idx')
    .on(table.organizationId, table.sourceType, table.externalId)
    .where(sql`${table.externalId} IS NOT NULL`),
  orgSourceUniqueWhenNull: uniqueIndex('source_content_org_type_null_external_idx')
    .on(table.organizationId, table.sourceType)
    .where(sql`${table.externalId} IS NULL`)
}))

export const sourceContentRelations = relations(sourceContent, ({ one }) => ({
  organization: one(organization, {
    fields: [sourceContent.organizationId],
    references: [organization.id]
  }),
  creator: one(user, {
    fields: [sourceContent.createdByUserId],
    references: [user.id]
  })
}))
