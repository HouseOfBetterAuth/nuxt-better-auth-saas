import { relations } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { organization, user } from './auth'
import { sourceContent } from './sourceContent'

export const conversationStatusEnum = pgEnum('conversation_status', ['active', 'archived', 'completed'])

export const conversation = pgTable('conversation', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  sourceContentId: uuid('source_content_id')
    .references(() => sourceContent.id, { onDelete: 'set null' }),
  createdByUserId: text('created_by_user_id')
    .references(() => user.id, { onDelete: 'set null' }),
  status: conversationStatusEnum('status').default('active').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
}, table => ({
  organizationIdx: index('conversation_org_idx').on(table.organizationId),
  sourceIdx: index('conversation_source_idx').on(table.sourceContentId)
}))

export const conversationMessage = pgTable('conversation_message', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  payload: jsonb('payload').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  conversationIdx: index('conversation_message_conversation_idx').on(table.conversationId),
  organizationIdx: index('conversation_message_org_idx').on(table.organizationId),
  createdIdx: index('conversation_message_created_idx').on(table.createdAt)
}))

export const conversationLog = pgTable('conversation_log', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  type: text('type').default('info').notNull(),
  message: text('message').notNull(),
  payload: jsonb('payload').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  conversationIdx: index('conversation_log_conversation_idx').on(table.conversationId),
  organizationIdx: index('conversation_log_org_idx').on(table.organizationId),
  typeIdx: index('conversation_log_type_idx').on(table.type)
}))

// Relations will be updated after content schema is loaded to avoid circular dependency
export const conversationRelations = relations(conversation, ({ one, many }) => ({
  organization: one(organization, {
    fields: [conversation.organizationId],
    references: [organization.id]
  }),
  // content relation will be added in content.ts to avoid circular dependency
  sourceContent: one(sourceContent, {
    fields: [conversation.sourceContentId],
    references: [sourceContent.id]
  }),
  creator: one(user, {
    fields: [conversation.createdByUserId],
    references: [user.id]
  }),
  messages: many(conversationMessage),
  logs: many(conversationLog)
}))

export const conversationMessageRelations = relations(conversationMessage, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationMessage.conversationId],
    references: [conversation.id]
  }),
  organization: one(organization, {
    fields: [conversationMessage.organizationId],
    references: [organization.id]
  })
}))

export const conversationLogRelations = relations(conversationLog, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationLog.conversationId],
    references: [conversation.id]
  }),
  organization: one(organization, {
    fields: [conversationLog.organizationId],
    references: [organization.id]
  })
}))
