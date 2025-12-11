import { relations } from 'drizzle-orm'
import { bigint, boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { user } from './auth'
import { content } from './content'

export const file = pgTable('file', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  originalName: text('original_name').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileType: text('file_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  path: text('path').notNull(),
  url: text('url'),
  storageProvider: text('storage_provider').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
  contentId: uuid('content_id').references(() => content.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

export const fileRelations = relations(file, ({ one }) => ({
  uploadedByUser: one(user, {
    fields: [file.uploadedBy],
    references: [user.id]
  }),
  content: one(content, {
    fields: [file.contentId],
    references: [content.id]
  })
}))
