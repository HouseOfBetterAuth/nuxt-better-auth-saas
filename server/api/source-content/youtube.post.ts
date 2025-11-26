import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { ingestYouTubeSource } from '~~/server/services/sourceContent/youtubeIngest'
import { extractYouTubeId } from '~~/server/utils/chat'

interface YouTubeIngestBody {
  youtubeUrl: string
  titleHint?: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const body = await readBody<YouTubeIngestBody>(event)

  if (!body || typeof body.youtubeUrl !== 'string' || !body.youtubeUrl.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'youtubeUrl is required'
    })
  }

  let videoId: string | null = null
  try {
    const url = new URL(body.youtubeUrl.trim())
    videoId = extractYouTubeId(url)
  } catch {
    videoId = null
  }

  if (!videoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to parse YouTube video ID from the provided URL.'
    })
  }

  const upserted = await upsertSourceContent(db, {
    organizationId,
    userId: user.id,
    sourceType: 'youtube',
    externalId: videoId,
    title: typeof body.titleHint === 'string' ? body.titleHint : undefined,
    metadata: {
      originalUrl: body.youtubeUrl.trim(),
      youtube: {
        videoId
      }
    }
  })

  const ingested = await ingestYouTubeSource({
    db,
    sourceContentId: upserted.id,
    organizationId,
    userId: user.id,
    videoId
  })

  return {
    sourceContentId: ingested.id,
    ingestStatus: ingested.ingestStatus,
    sourceContent: ingested
  }
})
