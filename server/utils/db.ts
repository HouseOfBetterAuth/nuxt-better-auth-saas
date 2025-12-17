import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { EventHandlerRequest, H3Event } from 'h3'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '~~/server/db/schema'
import { getPgPool } from './drivers'
import { runtimeConfig } from './runtimeConfig'

type DatabaseInstance = NodePgDatabase<typeof schema>

const createDB = (dbSchema: typeof schema = schema) => {
  return drizzle({
    client: getPgPool(),
    schema: dbSchema
  })
}

let db: ReturnType<typeof createDB>

export const getDB = (): DatabaseInstance => {
  // Reuse a DB instance in node-server, but create new instances elsewhere
  // (e.g. tests, cloudflare module builds).
  if (runtimeConfig.preset == 'node-server') {
    if (!db)
      db = createDB()
    return db
  }

  return createDB()
}

export const useDB = async (event?: H3Event<EventHandlerRequest>): Promise<DatabaseInstance> => {
  if (event?.context.db)
    return event.context.db as DatabaseInstance

  const dbInstance = createDB(schema)
  if (event)
    event.context.db = dbInstance

  return dbInstance
}

export type TableNames = keyof typeof schema

export function isValidTable(table: string): table is TableNames {
  return table in schema
}
