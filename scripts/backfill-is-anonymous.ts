#!/usr/bin/env tsx
/**
 * Backfill script to set isAnonymous = true for existing organizations
 * that have slugs starting with 'anonymous-'.
 *
 * Run this after applying the migration that adds the isAnonymous column.
 *
 * Usage: pnpm db:backfill-is-anonymous
 */

import { sql } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { getDB } from '../server/utils/db'

async function backfillIsAnonymous() {
  console.log('Starting backfill of isAnonymous column...')

  const db = getDB()

  try {
    // Update all organizations with slugs starting with 'anonymous-' to have isAnonymous = true
    const result = await db
      .update(schema.organization)
      .set({ isAnonymous: true })
      .where(sql`${schema.organization.slug} LIKE 'anonymous-%'`)
      .returning({ id: schema.organization.id, slug: schema.organization.slug })

    console.log(`Updated ${result.length} organizations to isAnonymous = true`)
    if (result.length > 0) {
      console.log('Updated organizations:')
      result.forEach((org) => {
        console.log(`  - ${org.slug} (${org.id})`)
      })
    }

    // Also ensure all organizations without 'anonymous-' prefix have isAnonymous = false
    // (This is a safety check in case the default value wasn't applied correctly)
    await db
      .update(schema.organization)
      .set({ isAnonymous: false })
      .where(sql`${schema.organization.slug} NOT LIKE 'anonymous-%' AND (${schema.organization.isAnonymous} IS NULL OR ${schema.organization.isAnonymous} = true)`)

    console.log(`\nEnsured all non-anonymous organizations have isAnonymous = false`)

    console.log('\n✅ Backfill completed successfully!')
  } catch (error) {
    console.error('❌ Error during backfill:', error)
    process.exit(1)
  }
}

backfillIsAnonymous()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
