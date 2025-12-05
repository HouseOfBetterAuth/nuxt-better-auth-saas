import type { IngestYouTubeVideoAsSourceContentRequestBody } from '~~/server/types/sourceContent'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { ingestYouTubeVideoAsSourceContent } from '~~/server/services/sourceContent/youtubeIngest'
import { requireAuth } from '~~/server/utils/auth'
import { extractYouTubeId } from '~~/server/utils/chat'
import { useDB } from '~~/server/utils/db'
import { createServiceUnavailableError, createValidationError } from '~~/server/utils/errors'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateOptionalString, validateRequestBody, validateRequiredString } from '~~/server/utils/validation'

/**
 * Ingests a YouTube video as source content
 *
 * @description Fetches transcript from YouTube video and creates source content with chunks
 *
 * @param youtubeUrl - YouTube video URL (required)
 * @param titleHint - Optional title hint for the source content
 * @returns Source content record with ingest status
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  if (!runtimeConfig.enableYoutubeIngestion) {
    throw createServiceUnavailableError('YouTube ingestion is currently disabled')
  }

  const body = await readBody<IngestYouTubeVideoAsSourceContentRequestBody>(event)

  validateRequestBody(body)

  const youtubeUrl = validateRequiredString(body.youtubeUrl, 'youtubeUrl')
  const titleHint = validateOptionalString(body.titleHint, 'titleHint')

  let videoId: string | null = null
  try {
    const url = new URL(youtubeUrl)
    videoId = extractYouTubeId(url)
  } catch {
    videoId = null
  }

  if (!videoId) {
    throw createValidationError('Unable to parse YouTube video ID from the provided URL.')
  }

  const upserted = await upsertSourceContent(db, {
    organizationId,
    userId: user.id,
    sourceType: 'youtube',
    externalId: videoId,
    title: titleHint ?? undefined,
    metadata: {
      originalUrl: youtubeUrl,
      youtube: {
        videoId
      }
    }
  })

  const ingested = await ingestYouTubeVideoAsSourceContent({
    event,
    db,
    sourceContentId: upserted.id,
    organizationId,
    userId: user.id,
    videoId
  })

  return {
    sourceContentId: ingested.id,
    ingestStatus: ingested.ingestStatus,
    sourceContent: {
      id: ingested.id,
      organizationId: ingested.organizationId,
      sourceType: ingested.sourceType,
      externalId: ingested.externalId,
      title: ingested.title,
      ingestStatus: ingested.ingestStatus,
      createdAt: ingested.createdAt.toISOString(),
      updatedAt: ingested.updatedAt.toISOString()
    }
  }
})
