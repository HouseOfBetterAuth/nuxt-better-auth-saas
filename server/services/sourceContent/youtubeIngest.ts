import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FetchError } from 'ofetch'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '../../database/schema'
import { createChunksFromSourceContentText } from './chunkSourceContent'

const TOKEN_REFRESH_BUFFER_MS = 60_000

export type TranscriptFailureReason =
  | 'no_captions'
  | 'blocked'
  | 'private_or_unavailable'
  | 'rate_limited'
  | 'no_account'
  | 'permission_denied'
  | 'auth_failed'
  | 'empty_transcript'
  | 'internal_error'
  | 'quota_exceeded'
  | 'video_not_found'
  | 'invalid_credentials'
  | 'unknown'

export interface YouTubeTranscriptErrorData {
  transcriptFailed: true
  reasonCode: TranscriptFailureReason
  userMessage: string
  suggestAccountLink?: boolean
  canRetry?: boolean
  videoId: string
  workerError?: string
  accountLinkHint?: string
}

interface IngestYouTubeOptions {
  db: NodePgDatabase<typeof schema>
  sourceContentId: string
  organizationId: string
  userId: string
  videoId: string
}

interface YoutubeOEmbedResponse {
  title?: string
  author_name?: string
  thumbnail_url?: string
  provider_name?: string
  provider_url?: string
}

interface YouTubeCaptionTrack {
  id: string
  snippet: {
    videoId: string
    language: string
    name?: string
    trackKind?: string
  }
}

function hasYouTubeScopes(scope: string | null | undefined) {
  if (!scope) {
    return false
  }
  // Check for full YouTube API scope URLs (more explicit and reliable)
  return scope.includes('https://www.googleapis.com/auth/youtube') ||
    scope.includes('https://www.googleapis.com/auth/youtube.force-ssl')
}

function _stripVttToPlainText(vtt: string) {
  return vtt
    .split(/\r?\n+/)
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'WEBVTT') {
        return false
      }
      if (/^\d+$/.test(trimmed)) {
        return false
      }
      if (trimmed.includes('-->')) {
        return false
      }
      return true
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function _classifyTranscriptFailure(message: string, statusCode?: number) {
  const lowerMessage = message.toLowerCase()

  if (statusCode === 403 && lowerMessage.includes('quota')) {
    return { reasonCode: 'quota_exceeded' as const, userMessage: 'YouTube API quota exceeded. Please try again later.', canRetry: true }
  }
  if (statusCode === 404 || lowerMessage.includes('not found') || lowerMessage.includes('video not found')) {
    return { reasonCode: 'video_not_found' as const, userMessage: 'This video was not found.' }
  }
  if (lowerMessage.includes('no captions') || lowerMessage.includes('no transcripts') || lowerMessage.includes('caption track not found')) {
    return { reasonCode: 'no_captions' as const, userMessage: 'This video doesn\'t have captions available.', canRetry: false }
  }
  if (lowerMessage.includes('block') || lowerMessage.includes('forbidden') || statusCode === 403) {
    return { reasonCode: 'blocked' as const, userMessage: 'Access to this video\'s captions is restricted.' }
  }
  if (lowerMessage.includes('private') || lowerMessage.includes('unavailable')) {
    return { reasonCode: 'private_or_unavailable' as const, userMessage: 'This video is private or unavailable.' }
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many') || statusCode === 429) {
    return { reasonCode: 'rate_limited' as const, userMessage: 'Too many requests, please try again later.', canRetry: true }
  }
  if (lowerMessage.includes('permission denied') || lowerMessage.includes('insufficient permission') || (statusCode === 403 && lowerMessage.includes('caption'))) {
    return { reasonCode: 'permission_denied' as const, userMessage: 'You can only get transcripts for videos you own. This video belongs to another channel.' }
  }
  if (lowerMessage.includes('authentication failed') || lowerMessage.includes('access token') || lowerMessage.includes('invalid credentials') || statusCode === 401) {
    return { reasonCode: 'auth_failed' as const, userMessage: 'YouTube authentication failed. Please reconnect your account.' }
  }
  if (lowerMessage.includes('empty content') || lowerMessage.includes('empty transcript')) {
    return { reasonCode: 'empty_transcript' as const, userMessage: 'The transcript was empty or could not be read.' }
  }

  return { reasonCode: 'unknown' as const, userMessage: 'Unable to fetch transcript.' }
}

function createTranscriptError(params: {
  reasonCode: TranscriptFailureReason
  userMessage: string
  suggestAccountLink?: boolean
  canRetry?: boolean
  videoId: string
  workerError?: string
  accountLinkHint?: string
}) {
  return createError({
    statusCode: 400,
    statusMessage: params.userMessage,
    data: {
      transcriptFailed: true,
      ...params
    } satisfies YouTubeTranscriptErrorData
  })
}

async function fetchTranscriptViaOfficialAPI(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
  videoId: string
): Promise<{ text: string, format: string, language: string | null, trackKind: string | null, metadata: any }> {
  // Check for YouTube account
  const account = await findYouTubeAccount(db, organizationId, userId)
  if (!account) {
    throw createTranscriptError({
      reasonCode: 'no_account',
      userMessage: 'No YouTube account linked. Please link your YouTube account from Settings -> Integrations to enable transcript fetching.',
      videoId,
      suggestAccountLink: true
    })
  }

  // Get access token
  let accessToken: string
  try {
    accessToken = await ensureAccessToken(db, account)
  } catch (error) {
    const errorMessage = (error as Error).message || 'Failed to get access token.'
    throw createTranscriptError({
      reasonCode: 'auth_failed',
      userMessage: 'YouTube authentication failed. Please reconnect your account.',
      videoId,
      workerError: errorMessage,
      suggestAccountLink: true
    })
  }

  // Fetch video metadata for better error context (title, channel name)
  let videoMetadata: { title: string, channelTitle: string } | null = null
  try {
    const videoResponse = await $fetch<{ items?: Array<{ snippet?: { title?: string, channelTitle?: string } }> }>('https://youtube.googleapis.com/youtube/v3/videos', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        part: 'snippet',
        id: videoId
      }
    })

    const videoItem = videoResponse?.items?.[0]
    if (videoItem?.snippet) {
      videoMetadata = {
        title: videoItem.snippet.title || 'Untitled Video',
        channelTitle: videoItem.snippet.channelTitle || 'Unknown Channel'
      }
    }
  } catch (error) {
    // Non-fatal - we'll continue without metadata
    console.warn('[youtube-ingest] Failed to fetch video metadata for context:', error)
  }

  // Verify video ownership before attempting to access captions
  // YouTube API only allows downloading captions for videos the authenticated user owns
  try {
    const ownershipResponse = await $fetch<{ items?: Array<{ id: string }> }>('https://youtube.googleapis.com/youtube/v3/videos', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        part: 'id',
        id: videoId,
        mine: true // Only videos owned by authenticated user
      }
    })

    if (!ownershipResponse?.items || ownershipResponse.items.length === 0) {
      const videoContext = videoMetadata
        ? `"${videoMetadata.title}" (${videoMetadata.channelTitle})`
        : 'this video'
      throw createTranscriptError({
        reasonCode: 'permission_denied',
        userMessage: `You can only get transcripts for videos you own. ${videoContext} belongs to another channel.`,
        videoId,
        canRetry: false
      })
    }
  } catch (error) {
    // If it's already a TranscriptError, re-throw it
    if ((error as any)?.data?.transcriptFailed) {
      throw error
    }
    // For other errors (network, API issues), continue to attempt caption access
    // The caption API will return a proper error if ownership is still an issue
    const fetchError = error as FetchError
    const statusCode = fetchError?.statusCode
    if (statusCode === 403 || statusCode === 404) {
      const videoContext = videoMetadata
        ? `"${videoMetadata.title}" (${videoMetadata.channelTitle})`
        : 'this video'
      throw createTranscriptError({
        reasonCode: 'permission_denied',
        userMessage: `You can only get transcripts for videos you own. ${videoContext} belongs to another channel.`,
        videoId,
        canRetry: false
      })
    }
    // For other errors, log but continue - let the caption API handle it
    console.warn('[youtube-ingest] Video ownership check failed, continuing to caption API:', error)
  }

  // List available caption tracks
  let captionTracks: YouTubeCaptionTrack[]
  try {
    const captionsResponse = await $fetch<{ items: YouTubeCaptionTrack[] }>('https://youtube.googleapis.com/youtube/v3/captions', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        part: 'snippet',
        videoId
      }
    })

    captionTracks = captionsResponse?.items || []
  } catch (error) {
    const fetchError = error as FetchError
    const statusCode = fetchError?.statusCode
    const errorMessage = (error as Error).message || 'Failed to list caption tracks.'
    const failure = _classifyTranscriptFailure(errorMessage, statusCode)

    // Add video context to error message if available
    const videoContext = videoMetadata
      ? ` for "${videoMetadata.title}"`
      : ''
    const enhancedMessage = failure.userMessage + videoContext

    throw createTranscriptError({
      ...failure,
      userMessage: enhancedMessage,
      videoId,
      workerError: errorMessage,
      suggestAccountLink: failure.reasonCode === 'auth_failed' || failure.reasonCode === 'permission_denied'
    })
  }

  // Check caption availability with better messaging
  if (!captionTracks || captionTracks.length === 0) {
    const videoContext = videoMetadata
      ? `"${videoMetadata.title}" doesn't have captions available.`
      : 'This video doesn\'t have captions available.'
    const suggestion = 'Please enable captions in YouTube Studio (Settings > Subtitles) or add manual captions to your video.'

    throw createTranscriptError({
      reasonCode: 'no_captions',
      userMessage: `${videoContext} ${suggestion}`,
      videoId,
      canRetry: false
    })
  }

  // Select best caption track: prefer auto-generated, then manual
  const autoTrack = captionTracks.find(track => track.snippet?.trackKind === 'ASR' || track.snippet?.name?.toLowerCase().includes('auto'))
  const manualTrack = captionTracks.find(track => track.snippet?.trackKind === 'standard')
  const selectedTrack = autoTrack || manualTrack || captionTracks[0]

  if (!selectedTrack?.id) {
    const videoContext = videoMetadata
      ? `"${videoMetadata.title}" has no valid caption tracks available.`
      : 'No valid caption track found for this video.'
    const suggestion = 'Please enable auto-generated captions or add manual captions in YouTube Studio.'

    throw createTranscriptError({
      reasonCode: 'no_captions',
      userMessage: `${videoContext} ${suggestion}`,
      videoId,
      canRetry: false
    })
  }

  // Download caption track as VTT
  let vttContent: string
  try {
    vttContent = await $fetch<string>(`https://youtube.googleapis.com/youtube/v3/captions/${selectedTrack.id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        tfmt: 'vtt'
      }
    })
  } catch (error) {
    const fetchError = error as FetchError
    const statusCode = fetchError?.statusCode
    const errorMessage = (error as Error).message || 'Failed to download caption track.'
    const failure = _classifyTranscriptFailure(errorMessage, statusCode)

    // Add video context to error message if available
    const videoContext = videoMetadata
      ? ` for "${videoMetadata.title}"`
      : ''
    const enhancedMessage = failure.userMessage + videoContext

    throw createTranscriptError({
      ...failure,
      userMessage: enhancedMessage,
      videoId,
      workerError: errorMessage,
      suggestAccountLink: failure.reasonCode === 'auth_failed' || failure.reasonCode === 'permission_denied'
    })
  }

  // Parse VTT to plain text
  const text = _stripVttToPlainText(vttContent)
  if (!text || text.trim().length === 0) {
    throw createTranscriptError({
      reasonCode: 'empty_transcript',
      userMessage: 'The transcript was empty or could not be read.',
      videoId,
      canRetry: false
    })
  }

  return {
    text,
    format: 'text',
    language: selectedTrack.snippet?.language || null,
    trackKind: selectedTrack.snippet?.trackKind || null,
    metadata: {
      method: 'youtube_api_v3',
      provider: 'youtube_api_v3',
      video_id: videoId,
      caption_id: selectedTrack.id,
      language: selectedTrack.snippet?.language,
      track_kind: selectedTrack.snippet?.trackKind,
      track_name: selectedTrack.snippet?.name,
      available_tracks: captionTracks.map(track => ({
        id: track.id,
        language: track.snippet?.language,
        kind: track.snippet?.trackKind,
        name: track.snippet?.name
      }))
    }
  }
}

function getBaseMetadata(metadata: any) {
  return metadata && typeof metadata === 'object' ? { ...metadata } : {}
}

function getBaseYoutubeMetadata(metadata: any) {
  if (metadata && typeof metadata === 'object' && metadata.youtube && typeof metadata.youtube === 'object') {
    return { ...metadata.youtube }
  }
  return {}
}

function normalizeMetadataString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function fetchYoutubePreview(videoId: string): Promise<YoutubeOEmbedResponse | null> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`

  try {
    const response = await $fetch<YoutubeOEmbedResponse>(endpoint)
    return response
  } catch (error) {
    console.warn('[youtube-oembed] Failed to fetch preview metadata', {
      videoId,
      error: (error as Error)?.message || error
    })
    return null
  }
}

async function refreshGoogleAccessToken(db: NodePgDatabase<typeof schema>, account: typeof schema.account.$inferSelect) {
  if (!account.refreshToken) {
    throw new Error('Google account is missing a refresh token.')
  }

  const { googleClientId, googleClientSecret } = runtimeConfig

  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google OAuth client configuration is missing. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.')
  }

  const params = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  })

  const response = await $fetch<{
    access_token: string
    expires_in: number
    refresh_token?: string
  }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

  const expiresAt = new Date(Date.now() + (response.expires_in || 3600) * 1000)

  const [updated] = await db
    .update(schema.account)
    .set({
      accessToken: response.access_token,
      refreshToken: response.refresh_token || account.refreshToken,
      accessTokenExpiresAt: expiresAt,
      updatedAt: new Date()
    })
    .where(eq(schema.account.id, account.id))
    .returning()

  return updated
}

export async function ensureAccessToken(db: NodePgDatabase<typeof schema>, account: typeof schema.account.$inferSelect) {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    new Date(account.accessTokenExpiresAt).getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return account.accessToken
  }
  const refreshed = await refreshGoogleAccessToken(db, account)

  if (!refreshed || !refreshed.accessToken) {
    throw new Error('Failed to refresh Google access token: response did not include access_token.')
  }

  return refreshed.accessToken
}

export async function fetchYouTubeVideoMetadata(accessToken: string, videoId: string): Promise<{ title: string, description: string } | null> {
  try {
    const response = await $fetch<any>('https://youtube.googleapis.com/youtube/v3/videos', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        part: 'snippet',
        id: videoId
      }
    })

    const item = response?.items?.[0]
    if (!item) {
      return null
    }

    return {
      title: item.snippet?.title || 'Untitled Video',
      description: item.snippet?.description || ''
    }
  } catch (error) {
    console.error('Failed to fetch YouTube video metadata', error)
    return null
  }
}

export async function findYouTubeAccount(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string) {
  const [userAccount] = await db
    .select()
    .from(schema.account)
    .where(and(
      eq(schema.account.userId, userId),
      eq(schema.account.providerId, 'google')
    ))
    .limit(1)

  if (userAccount && hasYouTubeScopes(userAccount.scope)) {
    return userAccount
  }

  const orgAccounts = await db
    .select({
      account: schema.account
    })
    .from(schema.account)
    .innerJoin(schema.member, eq(schema.member.userId, schema.account.userId))
    .where(and(
      eq(schema.member.organizationId, organizationId),
      eq(schema.account.providerId, 'google')
    ))

  for (const entry of orgAccounts) {
    if (hasYouTubeScopes(entry.account.scope)) {
      return entry.account
    }
  }

  return undefined
}

/**
 * Ingests a YouTube video as source content by fetching transcript and creating chunks
 *
 * @param options - Options for ingesting YouTube video
 * @returns Updated source content record with transcript
 */
export async function ingestYouTubeVideoAsSourceContent(options: IngestYouTubeOptions) {
  const { db, sourceContentId, organizationId: _organizationId, userId: _userId, videoId } = options

  const [source] = await db
    .select()
    .from(schema.sourceContent)
    .where(eq(schema.sourceContent.id, sourceContentId))
    .limit(1)

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Source content not found for ingest' })
  }

  if (source.ingestStatus === 'ingested') {
    return source
  }

  const baseMetadata = getBaseMetadata(source.metadata)
  const existingYoutubeMetadata = getBaseYoutubeMetadata(source.metadata)
  let transcriptText: string | null = null
  let youtubeMetadata = { ...existingYoutubeMetadata }
  let transcriptResult: Awaited<ReturnType<typeof fetchTranscriptViaOfficialAPI>> | null = null
  const previewMetadata = await fetchYoutubePreview(videoId)

  try {
    transcriptResult = await fetchTranscriptViaOfficialAPI(db, options.organizationId, options.userId, videoId)
  } catch (error) {
    const errorMessage = (error as Error).message || 'Unable to fetch transcript from YouTube API.'

    await db
      .update(schema.sourceContent)
      .set({
        ingestStatus: 'failed',
        metadata: {
          ...baseMetadata,
          ingestMethod: 'youtube_api_v3',
          youtube: {
            ...youtubeMetadata,
            lastError: errorMessage,
            lastIngestedAt: new Date().toISOString()
          }
        },
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, sourceContentId))

    // Re-throw the error (it's already a createTranscriptError if from our function)
    throw error
  }

  transcriptText = transcriptResult.text
  const providerMethod = transcriptResult.metadata?.method || 'youtube_api_v3'
  youtubeMetadata = {
    ...youtubeMetadata,
    transcriptMethod: providerMethod,
    language: transcriptResult.language,
    trackKind: transcriptResult.trackKind,
    transcriptFormat: transcriptResult.format,
    workerMetadata: transcriptResult.metadata,
    lastIngestedAt: new Date().toISOString()
  }
  const ingestMethod = 'youtube_api_v3'

  if (previewMetadata) {
    youtubeMetadata.preview = {
      ...(youtubeMetadata.preview ?? {}),
      title: previewMetadata.title ?? youtubeMetadata.preview?.title ?? null,
      authorName: previewMetadata.author_name ?? youtubeMetadata.preview?.authorName ?? null,
      thumbnailUrl: previewMetadata.thumbnail_url ?? youtubeMetadata.preview?.thumbnailUrl ?? null,
      providerName: previewMetadata.provider_name ?? youtubeMetadata.preview?.providerName ?? null
    }
    if (!baseMetadata.originalUrl) {
      baseMetadata.originalUrl = `https://www.youtube.com/watch?v=${videoId}`
    }
  }

  const resolvedTitle =
    normalizeMetadataString(baseMetadata.title) ||
    normalizeMetadataString(youtubeMetadata.preview?.title) ||
    normalizeMetadataString(source.title)

  const metadata = {
    ...baseMetadata,
    title: resolvedTitle ?? null,
    ingestMethod,
    youtube: youtubeMetadata
  }

  const [processing] = await db
    .update(schema.sourceContent)
    .set({
      sourceText: transcriptText,
      ingestStatus: 'processing',
      metadata,
      title: resolvedTitle ?? null,
      updatedAt: new Date()
    })
    .where(eq(schema.sourceContent.id, sourceContentId))
    .returning()

  if (!processing) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to mark source content as processing'
    })
  }

  try {
    await createChunksFromSourceContentText({
      db,
      sourceContent: processing
    })

    const [updated] = await db
      .update(schema.sourceContent)
      .set({
        ingestStatus: 'ingested',
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, sourceContentId))
      .returning()

    if (!updated) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update source content after ingestion'
      })
    }

    return updated
  } catch (error) {
    const errorMessage = (error as Error).message || 'Failed to chunk source content.'
    await db
      .update(schema.sourceContent)
      .set({
        ingestStatus: 'failed',
        metadata: {
          ...metadata,
          youtube: {
            ...metadata.youtube,
            lastError: errorMessage
          }
        },
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, sourceContentId))
      .returning()

    throw error
  }
}
