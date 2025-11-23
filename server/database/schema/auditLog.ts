import { pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  category: text('category').notNull(), // e.g., 'auth', 'email', 'payment'
  action: text('action').notNull(), // e.g., 'login', 'register', 'verification'
  targetType: text('target_type'), // e.g., 'user', 'email'
  targetId: text('target_id'), // ID of the target entity
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status').notNull().default('success'), // e.g., 'success', 'failure', 'pending'
  details: text('details'), // Additional details or error messages
  createdAt: timestamp('created_at').notNull().$default(() => new Date())
})
