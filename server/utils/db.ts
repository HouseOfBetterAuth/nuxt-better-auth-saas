import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { EventHandlerRequest, H3Event } from 'h3'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '../database/schema'
import { getPgPool } from './drivers'
import { runtimeConfig } from './runtimeConfig'

const createDB = (dbSchema?: typeof schema) => {
  return drizzle({ client: getPgPool(), schema: dbSchema })
}

let db: ReturnType<typeof createDB>

export const getDB = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!db) {
      db = createDB()
    }
    return db
  } else {
    return createDB()
  }
}

// use db with schema
export const useDB = async (event?: H3Event<EventHandlerRequest>): Promise<NodePgDatabase<typeof schema>> => {
  // If the event has a context with a db property, return it
  if (event && event.context.db) {
    return event.context.db
  }
  // Otherwise, create a new connection to the database
  const dbInstance = createDB(schema)
  if (event) {
    event.context.db = dbInstance
  }
  return dbInstance
}

export type TableNames = keyof typeof schema

export function isValidTable(table: string): table is TableNames {
  return table in schema
}
