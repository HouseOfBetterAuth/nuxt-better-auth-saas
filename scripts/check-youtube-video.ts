import { and, eq } from 'drizzle-orm'
import * as schema from '../server/database/schema'
import { getDB } from '../server/utils/db'

const videoId = 'MHfYg77rJ-s'

async function checkYouTubeVideo() {
  const db = getDB()

  console.log(`\n🔍 Checking database for YouTube video: ${videoId}\n`)

  // Find all source content records for this YouTube video
  const records = await db
    .select()
    .from(schema.sourceContent)
    .where(and(
      eq(schema.sourceContent.sourceType, 'youtube'),
      eq(schema.sourceContent.externalId, videoId)
    ))
    .orderBy(schema.sourceContent.createdAt)

  if (records.length === 0) {
    console.log('❌ No records found for this YouTube video ID')
    return
  }

  console.log(`✅ Found ${records.length} record(s):\n`)

  for (const record of records) {
    console.log('─'.repeat(80))
    console.log(`ID: ${record.id}`)
    console.log(`Organization ID: ${record.organizationId}`)
    console.log(`Created By User ID: ${record.createdByUserId}`)
    console.log(`Source Type: ${record.sourceType}`)
    console.log(`External ID: ${record.externalId}`)
    console.log(`Title: ${record.title || '(no title)'}`)
    console.log(`Ingest Status: ${record.ingestStatus}`)
    console.log(`Created At: ${record.createdAt}`)
    console.log(`Updated At: ${record.updatedAt}`)

    if (record.metadata) {
      console.log(`\nMetadata:`)
      console.log(JSON.stringify(record.metadata, null, 2))

      // Check for YouTube-specific error information
      const youtubeMeta = record.metadata?.youtube
      if (youtubeMeta) {
        console.log(`\nYouTube Metadata:`)
        if (youtubeMeta.lastError) {
          console.log(`  ❌ Last Error: ${youtubeMeta.lastError}`)
        }
        if (youtubeMeta.reasonCode) {
          console.log(`  ⚠️  Reason Code: ${youtubeMeta.reasonCode}`)
        }
        if (youtubeMeta.transcriptFailed) {
          console.log(`  ❌ Transcript Failed: ${youtubeMeta.transcriptFailed}`)
        }
        if (youtubeMeta.transcriptMethod) {
          console.log(`  📝 Transcript Method: ${youtubeMeta.transcriptMethod}`)
        }
      }
    }

    if (record.sourceText) {
      const textLength = record.sourceText.length
      console.log(`\nSource Text: ${textLength} characters`)
      if (textLength > 0) {
        console.log(`Preview: ${record.sourceText.substring(0, 200)}...`)
      }
    } else {
      console.log(`\nSource Text: (empty)`)
    }

    console.log('─'.repeat(80))
    console.log('')
  }
}

checkYouTubeVideo()
  .then(() => {
    console.log('\n✅ Query complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error)
    process.exit(1)
  })
