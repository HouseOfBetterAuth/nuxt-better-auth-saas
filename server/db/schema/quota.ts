import { boolean, index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { organization } from './auth'

export const quotaUsageLog = pgTable('quota_usage_log', {
  id: serial('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  quotaLimit: integer('quota_limit'),
  used: integer('used').notNull(),
  remaining: integer('remaining'),
  profile: text('profile'),
  label: text('label'),
  unlimited: boolean('unlimited').default(false).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, table => ({
  orgIdx: index('quota_usage_log_org_idx').on(table.organizationId),
  createdIdx: index('quota_usage_log_created_idx').on(table.createdAt)
}))
