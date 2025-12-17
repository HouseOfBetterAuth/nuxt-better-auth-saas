import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '~~/server/db/schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString)
  throw new Error('DATABASE_URL is required for hub:db stub')

const client = postgres(connectionString, {
  max: 1,
  prepare: false
})

export const db = drizzle(client, { schema })
export { schema }

process.once('beforeExit', async () => {
  await client.end({ timeout: 5 })
})
