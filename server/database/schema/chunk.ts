import { relations } from 'drizzle-orm'
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { organization } from './auth'
import { sourceContent } from './sourceContent'

export const chunk = pgTable('chunk', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  sourceContentId: text('source_content_id')
    .notNull()
    .references(() => sourceContent.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  startChar: integer('start_char').notNull(),
  endChar: integer('end_char').notNull(),
  text: text('text').notNull(),
  textPreview: text('text_preview'),
  embedding: jsonb('embedding').$type<number[] | null>().default(null),
  metadata: jsonb('metadata').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

export const chunkRelations = relations(chunk, ({ one }) => ({
  sourceContent: one(sourceContent, {
    fields: [chunk.sourceContentId],
    references: [sourceContent.id]
  }),
  organization: one(organization, {
    fields: [chunk.organizationId],
    references: [organization.id]
  })
}))
