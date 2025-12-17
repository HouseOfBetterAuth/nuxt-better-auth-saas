import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { EventHandlerRequest, H3Event } from 'h3'
import { db as hubDb } from 'hub:db'

import * as schema from '~~/server/db/schema'

type DatabaseInstance = NodePgDatabase<typeof schema>

const database = hubDb as unknown as DatabaseInstance

export const getDB = (): DatabaseInstance => database

export const useDB = async (event?: H3Event<EventHandlerRequest>): Promise<DatabaseInstance> => {
  if (event?.context.db)
    return event.context.db as DatabaseInstance

  if (event)
    event.context.db = database

  return database
}

export type TableNames = keyof typeof schema

export function isValidTable(table: string): table is TableNames {
  return table in schema
}
