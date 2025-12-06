import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FetchError } from 'ofetch'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import * as schema from '../../database/schema'
import { createChunksFromSourceContentText } from './chunkSourceContent'

const TOKEN_REFRESH_BUFFER_MS = 60_000

export type TranscriptFailureReason =
  | 'no_captions'
  | 'blocked'
  | 'private_or_unavailable'
  | 'rate_limited'
  | 'client_config'
  | 'no_account'
  | 'permission_denied'
  | 'auth_failed'
  | 'empty_transcript'
  | 'internal_error'
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

interface TranscriptIoResponseEntry {
  id?: string
  text?: string
  title?: string
  tracks?: Array<{
    language?: string | null
    kind?: string | null
    transcript?: Array<{ text?: string }>
  }>
  languages?: Array<{ label?: string | null, languageCode?: string | null }>
}

let transcriptIoCooldownUntil = 0

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

function _joinTranscriptSegments(segments: Array<{ text?: string }> | undefined) {
  if (!Array.isArray(segments) || !segments.length) {
    return ''
  }
  return segments
    .map(segment => typeof segment.text === 'string' ? segment.text.trim() : '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getRetryAfterSeconds(error: FetchError | undefined) {
  const headerValue = (error as any)?.response?.headers?.get?.('retry-after') || (error as any)?.response?.headers?.get?.('Retry-After')
  if (!headerValue) {
    return null
  }
  const parsed = Number.parseInt(String(headerValue), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function _classifyTranscriptFailure(message: string) {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('no captions') || lowerMessage.includes('no transcripts')) {
    return { reasonCode: 'no_captions' as const, userMessage: 'This video doesn\'t have captions available.', canRetry: false }
  }
  if (lowerMessage.includes('bot') || lowerMessage.includes('sign in to confirm')) {
    return { reasonCode: 'blocked' as const, userMessage: 'YouTube is blocking automated requests. Try linking your YouTube account for better access.', suggestAccountLink: true }
  }
  if (lowerMessage.includes('block') || lowerMessage.includes('forbidden')) {
    return { reasonCode: 'blocked' as const, userMessage: 'YouTube is blocking requests from our servers.' }
  }
  if (lowerMessage.includes('private') || lowerMessage.includes('unavailable') || lowerMessage.includes('not found')) {
    return { reasonCode: 'private_or_unavailable' as const, userMessage: 'This video is private or unavailable.' }
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many')) {
    return { reasonCode: 'rate_limited' as const, userMessage: 'Too many requests, please try again later.', canRetry: true }
  }
  if (lowerMessage.includes('client configuration')) {
    return { reasonCode: 'client_config' as const, userMessage: 'Unable to extract YouTube client configuration.' }
  }
  if (lowerMessage.includes('permission denied')) {
    return { reasonCode: 'permission_denied' as const, userMessage: 'You don\'t have access to this video\'s captions.' }
  }
  if (lowerMessage.includes('authentication failed') || lowerMessage.includes('access token')) {
    return { reasonCode: 'auth_failed' as const, userMessage: 'YouTube authentication failed. Please reconnect your account.' }
  }
  if (lowerMessage.includes('empty content')) {
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

function mapTranscriptIoError(statusCode?: number) {
  if (statusCode === 429) {
    return { reasonCode: 'rate_limited' as const, userMessage: 'Too many transcript requests, please wait a few seconds and try again.', canRetry: true }
  }
  if (statusCode === 404) {
    return { reasonCode: 'private_or_unavailable' as const, userMessage: 'Unable to find captions for this video.' }
  }
  if (statusCode === 401 || statusCode === 403) {
    return { reasonCode: 'blocked' as const, userMessage: 'Transcript provider rejected the request. Please try again later.' }
  }
  if (statusCode === 400) {
    return { reasonCode: 'private_or_unavailable' as const, userMessage: 'Invalid YouTube video ID for transcript provider.' }
  }
  return { reasonCode: 'unknown' as const, userMessage: 'Transcript provider failed to return captions.' }
}

class TranscriptProviderError extends Error {
  failure: { reasonCode: TranscriptFailureReason, userMessage: string, canRetry?: boolean }
  statusCode?: number

  constructor(message: string, failure: { reasonCode: TranscriptFailureReason, userMessage: string, canRetry?: boolean }, statusCode?: number) {
    super(message)
    this.failure = failure
    this.statusCode = statusCode
  }
}

function extractTranscriptIoText(entry: TranscriptIoResponseEntry) {
  if (entry && typeof entry.text === 'string' && entry.text.trim()) {
    return entry.text.trim()
  }
  const trackWithContent = Array.isArray(entry?.tracks)
    ? entry.tracks.find(track => Array.isArray(track.transcript) && track.transcript.some(segment => typeof segment?.text === 'string' && segment.text.trim()))
    : null
  if (trackWithContent?.transcript) {
    return _joinTranscriptSegments(trackWithContent.transcript)
  }
  return ''
}

async function fetchTranscriptViaTranscriptIo(videoId: string) {
  const token = runtimeConfig.youtubeTranscriptIoToken
  console.log('[youtube-transcript.io] Token check:', { hasToken: !!token })
  if (!token) {
    throw new TranscriptProviderError('Transcript provider is not configured.', { reasonCode: 'internal_error', userMessage: 'Transcript provider is not configured.' })
  }

  if (Date.now() < transcriptIoCooldownUntil) {
    const waitMs = Math.max(0, transcriptIoCooldownUntil - Date.now())
    const waitSeconds = Math.ceil(waitMs / 1000)
    throw new TranscriptProviderError(
      `Transcript provider temporarily rate limited. Please wait ~${waitSeconds}s before retrying.`,
      { reasonCode: 'rate_limited', userMessage: `Transcript provider is busy. Please wait about ${waitSeconds} seconds and try again.`, canRetry: true }
    )
  }

  try {
    const response = await $fetch<TranscriptIoResponseEntry[]>('https://www.youtube-transcript.io/api/transcripts', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json'
      },
      body: { ids: [videoId] }
    })

    const entry = Array.isArray(response) ? response[0] : null
    if (!entry) {
      throw new TranscriptProviderError('Transcript provider returned an empty response.', { reasonCode: 'unknown', userMessage: 'Transcript provider returned an empty response.' })
    }

    const text = extractTranscriptIoText(entry)
    if (!text) {
      throw new TranscriptProviderError('Transcript provider returned no transcript text.', { reasonCode: 'empty_transcript', userMessage: 'Transcript provider returned no transcript text.' })
    }

    const firstTrack = Array.isArray(entry.tracks) ? entry.tracks.find(track => Array.isArray(track.transcript) && track.transcript.length) ?? entry.tracks[0] : undefined
    const primaryLanguage = entry.languages?.[0]?.languageCode || firstTrack?.language || null

    return {
      text,
      format: 'text',
      language: primaryLanguage,
      trackKind: firstTrack?.kind || null,
      metadata: {
        method: 'youtube-transcript-io',
        provider: 'youtube_transcript_io',
        video_id: videoId,
        title: entry.title,
        languages: entry.languages,
        track_languages: entry.tracks?.map(track => track.language).filter(Boolean)
      }
    }
  } catch (error) {
    if (error instanceof TranscriptProviderError) {
      throw error
    }
    const statusCode = (error as FetchError)?.statusCode
    const errorMessage = (error as Error).message || 'Failed to fetch transcript via external provider.'
    const errorData = (error as FetchError)?.data

    // Log the actual error for debugging
    console.error('[youtube-transcript.io] Error details:', {
      statusCode,
      message: errorMessage,
      data: errorData,
      error
    })

    const retryAfterSeconds = getRetryAfterSeconds(error as FetchError)
    if (statusCode === 429) {
      const cooldownMs = Math.max(1000, (retryAfterSeconds ?? 10) * 1000)
      transcriptIoCooldownUntil = Date.now() + cooldownMs
    }
    const failure = mapTranscriptIoError(statusCode)
    if (statusCode === 429) {
      const waitSeconds = retryAfterSeconds ?? Math.ceil(Math.max(0, transcriptIoCooldownUntil - Date.now()) / 1000)
      failure.userMessage = `Transcript provider is rate limiting us. Please wait about ${waitSeconds} seconds and try again.`
      failure.canRetry = true
    }
    throw new TranscriptProviderError(errorMessage, failure, statusCode)
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
  let transcriptResult: Awaited<ReturnType<typeof fetchTranscriptViaTranscriptIo>> | null = null
  const previewMetadata = await fetchYoutubePreview(videoId)

  try {
    transcriptResult = await fetchTranscriptViaTranscriptIo(videoId)
  } catch (error) {
    const providerError = error as TranscriptProviderError | Error
    const failure = providerError instanceof TranscriptProviderError
      ? providerError.failure
      : mapTranscriptIoError((providerError as FetchError)?.statusCode)
    const errorMessage = providerError.message || 'Unable to fetch transcript from provider.'

    await db
      .update(schema.sourceContent)
      .set({
        ingestStatus: 'failed',
        metadata: {
          ...baseMetadata,
          ingestMethod: 'youtube_transcript_io',
          youtube: {
            ...youtubeMetadata,
            lastError: errorMessage,
            lastIngestedAt: new Date().toISOString()
          }
        },
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, sourceContentId))

    const shouldSuggestAccountLink = failure.reasonCode === 'auth_failed' || failure.reasonCode === 'permission_denied'
    const accountLinkHint = shouldSuggestAccountLink
      ? 'Link your YouTube account from Settings -> Integrations so we can fall back to the official API for higher accuracy captions.'
      : undefined

    throw createTranscriptError({
      ...failure,
      videoId,
      workerError: errorMessage,
      suggestAccountLink: shouldSuggestAccountLink,
      accountLinkHint
    })
  }

  transcriptText = transcriptResult.text
  const providerMethod = transcriptResult.metadata?.method || 'youtube-transcript-io'
  youtubeMetadata = {
    ...youtubeMetadata,
    transcriptMethod: providerMethod,
    language: transcriptResult.language,
    trackKind: transcriptResult.trackKind,
    transcriptFormat: transcriptResult.format,
    workerMetadata: transcriptResult.metadata,
    lastIngestedAt: new Date().toISOString()
  }
  const ingestMethod = 'youtube_transcript_io'

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
    normalizeMetadataString(transcriptResult.metadata?.title) ||
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
