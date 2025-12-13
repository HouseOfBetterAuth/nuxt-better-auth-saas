import { desc } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const db = await useDB(event)

  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt
    })
    .from(schema.organization)
    .orderBy(desc(schema.organization.createdAt))
    .limit(200)

  return { orgs }
})
