import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { account, organization, user } from './auth'
import { sourceContent } from './sourceContent'

export const content = pgTable('content', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  sourceContentId: text('source_content_id').references(() => sourceContent.id, { onDelete: 'set null' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: text('status').default('draft').notNull(),
  primaryKeyword: text('primary_keyword'),
  targetLocale: text('target_locale'),
  contentType: text('content_type').default('blog_post').notNull(),
  currentVersionId: text('current_version_id'), // maintained via transactional logic to avoid circular FK issues
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  publishedAt: timestamp('published_at')
}, table => ({
  organizationIdx: index('content_organization_idx').on(table.organizationId),
  slugOrgUnique: uniqueIndex('content_org_slug_idx').on(table.organizationId, table.slug)
}))

export const contentVersion = pgTable('content_version', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  contentId: text('content_id')
    .notNull()
    .references(() => content.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  frontmatter: jsonb('frontmatter').$type<Record<string, any> | null>().default(null),
  bodyMdx: text('body_mdx').notNull(),
  bodyHtml: text('body_html'),
  sections: jsonb('sections').$type<Record<string, any>[] | null>().default(null),
  assets: jsonb('assets').$type<Record<string, any> | null>().default(null),
  seoSnapshot: jsonb('seo_snapshot').$type<Record<string, any> | null>().default(null)
}, table => ({
  contentIdx: index('content_version_content_idx').on(table.contentId),
  contentVersionUnique: uniqueIndex('content_version_unique_idx').on(table.contentId, table.version)
}))

export const publication = pgTable('publication', {
  id: text('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  contentId: text('content_id')
    .notNull()
    .references(() => content.id, { onDelete: 'cascade' }),
  contentVersionId: text('content_version_id')
    .notNull()
    .references(() => contentVersion.id, { onDelete: 'cascade' }),
  integrationId: text('integration_id').references(() => account.id, { onDelete: 'set null' }),
  externalId: text('external_id'),
  status: text('status').default('pending').notNull(),
  publishedAt: timestamp('published_at'),
  payloadSnapshot: jsonb('payload_snapshot').$type<Record<string, any> | null>().default(null),
  responseSnapshot: jsonb('response_snapshot').$type<Record<string, any> | null>().default(null),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, table => ({
  organizationIdx: index('publication_organization_idx').on(table.organizationId),
  contentIdx: index('publication_content_idx').on(table.contentId),
  statusIdx: index('publication_status_idx').on(table.status)
}))

export const contentRelations = relations(content, ({ one, many }) => ({
  organization: one(organization, {
    fields: [content.organizationId],
    references: [organization.id]
  }),
  sourceContent: one(sourceContent, {
    fields: [content.sourceContentId],
    references: [sourceContent.id]
  }),
  creator: one(user, {
    fields: [content.createdByUserId],
    references: [user.id]
  }),
  versions: many(contentVersion),
  publications: many(publication)
}))

export const contentVersionRelations = relations(contentVersion, ({ one, many }) => ({
  content: one(content, {
    fields: [contentVersion.contentId],
    references: [content.id]
  }),
  creator: one(user, {
    fields: [contentVersion.createdByUserId],
    references: [user.id]
  }),
  publications: many(publication)
}))

export const publicationRelations = relations(publication, ({ one }) => ({
  organization: one(organization, {
    fields: [publication.organizationId],
    references: [organization.id]
  }),
  content: one(content, {
    fields: [publication.contentId],
    references: [content.id]
  }),
  contentVersion: one(contentVersion, {
    fields: [publication.contentVersionId],
    references: [contentVersion.id]
  }),
  integration: one(account, {
    fields: [publication.integrationId],
    references: [account.id]
  })
}))
