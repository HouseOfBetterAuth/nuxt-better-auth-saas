import { config } from 'dotenv'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
import * as schema from '../server/database/schema/index.js'

const { Pool } = pkg

config()

const pool = new Pool({
  connectionString: process.env.NUXT_DATABASE_URL || 'postgres://postgres:@localhost:5432/getquillio'
})

const db = drizzle(pool, { schema })

async function deleteAnonymousDrafts() {
  try {
    // Find anonymous user
    const anonymousUsers = await db.select().from(schema.user).where(eq(schema.user.isAnonymous, true)).limit(5)

    if (anonymousUsers.length === 0) {
      console.log('No anonymous users found')
      await pool.end()
      return
    }

    const userId = anonymousUsers[0].id
    console.log(`Found anonymous user: ${userId}`)

    // Find their organization
    const members = await db.select().from(schema.member).where(eq(schema.member.userId, userId)).limit(1)
    if (members.length === 0) {
      console.log('No organization found for anonymous user')
      await pool.end()
      return
    }

    const orgId = members[0].organizationId
    console.log(`Found organization: ${orgId}`)

    // Find content in their organization
    let contents = await db.select().from(schema.content).where(eq(schema.content.organizationId, orgId)).limit(10)
    console.log(`Found ${contents.length} content items in organization`)

    // If no content in org, check all content created by this user (might be in different org)
    if (contents.length === 0) {
      contents = await db.select().from(schema.content).where(eq(schema.content.createdByUserId, userId)).limit(10)
      console.log(`Found ${contents.length} content items created by user`)
    }

    // Also check all draft content
    if (contents.length === 0) {
      contents = await db.select().from(schema.content).where(eq(schema.content.status, 'draft')).limit(10)
      console.log(`Found ${contents.length} draft content items total`)
    }

    if (contents.length === 0) {
      console.log('No content to delete')
      try {
        await pool.end()
      } catch (e) {}
      return
    }

    // Delete 5 items to free up quota
    const toDelete = contents.slice(0, 5)
    const contentIds = toDelete.map(c => c.id)

    console.log(`Deleting ${toDelete.length} content items...`)

    // Delete content versions first (foreign key constraint)
    for (const contentId of contentIds) {
      await db.delete(schema.contentVersion).where(eq(schema.contentVersion.contentId, contentId))
    }
    console.log('Deleted content versions')

    // Delete content
    const deleted = await db.delete(schema.content)
      .where(inArray(schema.content.id, contentIds))
      .returning()

    console.log(`✅ Deleted ${deleted.length} content item(s)`)
    console.log('Drafts deleted successfully')
  } catch (error: any) {
    console.error('Error:', error.message)
    console.error(error.stack)
  } finally {
    try {
      await pool.end()
    } catch (e) {
      // Ignore double-end errors
    }
  }
}

deleteAnonymousDrafts()
