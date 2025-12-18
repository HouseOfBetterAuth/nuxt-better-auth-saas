import { relations, sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { account, organization } from './auth'

export const integration = pgTable('integration', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  authType: text('auth_type').notNull(),
  accountId: text('account_id').references(() => account.id, { onDelete: 'set null' }),
  baseUrl: text('base_url'),
  config: jsonb('config').$type<Record<string, any> | null>().default(null),
  capabilities: jsonb('capabilities').$type<Record<string, any> | null>().default(null),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
}, table => ({
  organizationIdx: index('integration_org_idx').on(table.organizationId),
  typeIdx: index('integration_type_idx').on(table.type),
  orgTypeAccountUnique: uniqueIndex('integration_org_type_account_not_null_idx')
    .on(table.organizationId, table.type, table.accountId)
    .where(sql`${table.accountId} IS NOT NULL`),
  orgTypeNullAccountUnique: uniqueIndex('integration_org_type_null_account_idx')
    .on(table.organizationId, table.type)
    .where(sql`${table.accountId} IS NULL`)
}))

export const integrationRelations = relations(integration, ({ one }) => ({
  organization: one(organization, {
    fields: [integration.organizationId],
    references: [organization.id]
  }),
  account: one(account, {
    fields: [integration.accountId],
    references: [account.id]
  })
}))
