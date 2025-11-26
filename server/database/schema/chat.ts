import { relations } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { organization, user } from './auth'
import { content } from './content'
import { sourceContent } from './sourceContent'

export const contentChatSession = pgTable('content_chat_session', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  contentId: text('content_id')
    .references(() => content.id, { onDelete: 'cascade' }),
  sourceContentId: text('source_content_id')
    .references(() => sourceContent.id, { onDelete: 'set null' }),
  createdByUserId: text('created_by_user_id')
    .references(() => user.id, { onDelete: 'set null' }),
  status: text('status').default('active').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
}, table => ({
  organizationIdx: index('content_chat_session_org_idx').on(table.organizationId),
  contentIdx: index('content_chat_session_content_idx').on(table.contentId),
  sourceIdx: index('content_chat_session_source_idx').on(table.sourceContentId)
}))

export const contentChatMessage = pgTable('content_chat_message', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  sessionId: text('session_id')
    .notNull()
    .references(() => contentChatSession.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  payload: jsonb('payload').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  sessionIdx: index('content_chat_message_session_idx').on(table.sessionId),
  organizationIdx: index('content_chat_message_org_idx').on(table.organizationId),
  createdIdx: index('content_chat_message_created_idx').on(table.createdAt)
}))

export const contentChatLog = pgTable('content_chat_log', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  sessionId: text('session_id')
    .notNull()
    .references(() => contentChatSession.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  type: text('type').default('info').notNull(),
  message: text('message').notNull(),
  payload: jsonb('payload').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  sessionIdx: index('content_chat_log_session_idx').on(table.sessionId),
  organizationIdx: index('content_chat_log_org_idx').on(table.organizationId),
  typeIdx: index('content_chat_log_type_idx').on(table.type)
}))

export const contentChatSessionRelations = relations(contentChatSession, ({ one, many }) => ({
  organization: one(organization, {
    fields: [contentChatSession.organizationId],
    references: [organization.id]
  }),
  content: one(content, {
    fields: [contentChatSession.contentId],
    references: [content.id]
  }),
  sourceContent: one(sourceContent, {
    fields: [contentChatSession.sourceContentId],
    references: [sourceContent.id]
  }),
  creator: one(user, {
    fields: [contentChatSession.createdByUserId],
    references: [user.id]
  }),
  messages: many(contentChatMessage),
  logs: many(contentChatLog)
}))

export const contentChatMessageRelations = relations(contentChatMessage, ({ one }) => ({
  session: one(contentChatSession, {
    fields: [contentChatMessage.sessionId],
    references: [contentChatSession.id]
  }),
  organization: one(organization, {
    fields: [contentChatMessage.organizationId],
    references: [organization.id]
  })
}))

export const contentChatLogRelations = relations(contentChatLog, ({ one }) => ({
  session: one(contentChatSession, {
    fields: [contentChatLog.sessionId],
    references: [contentChatSession.id]
  }),
  organization: one(organization, {
    fields: [contentChatLog.organizationId],
    references: [organization.id]
  })
}))
