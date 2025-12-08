import { config } from 'dotenv'
import { inArray, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
import * as schema from '../server/database/schema/index.js'

const { Pool } = pkg

config()

const pool = new Pool({
  connectionString: process.env.NUXT_DATABASE_URL || 'postgres://postgres:@localhost:5432/getquillio'
})

const db = drizzle(pool, { schema })

async function deleteAllAnonymousUsers() {
  try {
    // Find all anonymous organizations (they have slug starting with 'anonymous-')
    const anonymousOrgs = await db
      .select()
      .from(schema.organization)
      .where(like(schema.organization.slug, 'anonymous-%'))

    if (anonymousOrgs.length === 0) {
      console.log('No anonymous organizations found')
      try {
        await pool.end()
      } catch {
        // Ignore errors
      }
      return
    }

    console.log(`Found ${anonymousOrgs.length} anonymous organization(s)`)

    const orgIds = anonymousOrgs.map(org => org.id)

    // Get all content for these organizations
    const contents = await db.select().from(schema.content).where(inArray(schema.content.organizationId, orgIds))
    const contentIds = contents.map(c => c.id)
    console.log(`Found ${contentIds.length} content item(s) to delete`)

    // Get all users in these organizations
    const members = await db.select().from(schema.member).where(inArray(schema.member.organizationId, orgIds))
    const potentialUserIds = [...new Set(members.map(m => m.userId))]

    // Only delete users who are EXCLUSIVELY in anonymous organizations
    const allMemberships = await db.select().from(schema.member).where(inArray(schema.member.userId, potentialUserIds))
    const userIds = potentialUserIds.filter((userId) => {
      const userMemberships = allMemberships.filter(m => m.userId === userId)
      return userMemberships.every(m => orgIds.includes(m.organizationId))
    })

    console.log(`Found ${userIds.length} user(s) to delete (${potentialUserIds.length - userIds.length} user(s) excluded due to regular organization memberships)`)

    // Delete in order (respecting foreign keys)
    if (contentIds.length > 0) {
      console.log('Deleting content versions...')
      await db.delete(schema.contentVersion).where(inArray(schema.contentVersion.contentId, contentIds))

      console.log('Deleting content...')
      await db.delete(schema.content).where(inArray(schema.content.id, contentIds))
    }

    // Delete members
    if (orgIds.length > 0) {
      console.log('Deleting members...')
      await db.delete(schema.member).where(inArray(schema.member.organizationId, orgIds))
    }

    // Delete sessions for these users
    if (userIds.length > 0) {
      console.log('Deleting sessions...')
      await db.delete(schema.session).where(inArray(schema.session.userId, userIds))
    }

    // Delete accounts for these users
    if (userIds.length > 0) {
      console.log('Deleting accounts...')
      await db.delete(schema.account).where(inArray(schema.account.userId, userIds))
    }

    // Delete organizations
    if (orgIds.length > 0) {
      console.log('Deleting organizations...')
      const deletedOrgs = await db.delete(schema.organization)
        .where(inArray(schema.organization.id, orgIds))
        .returning()
      console.log(`Deleted ${deletedOrgs.length} organization(s)`)
    }

    // Finally delete anonymous users
    if (userIds.length > 0) {
      console.log('Deleting anonymous users...')
      const deleted = await db.delete(schema.user)
        .where(inArray(schema.user.id, userIds))
        .returning()
      console.log(`✅ Deleted ${deleted.length} anonymous user(s)`)
    }

    console.log('✅ All anonymous users, organizations, and associated data deleted successfully')
  } catch (error: any) {
    console.error('Error:', error.message)
    console.error(error.stack)
  } finally {
    try {
      await pool.end()
    } catch {
      // Ignore double-end errors
    }
  }
}

deleteAllAnonymousUsers()
