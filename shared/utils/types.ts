import type { file, user } from '~~/server/db/schema'

export type User = typeof user.$inferSelect
export type FileRecord = typeof file.$inferSelect
