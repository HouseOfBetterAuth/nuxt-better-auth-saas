import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import type { FetchError } from 'ofetch'
import { and, eq } from 'drizzle-orm'
import { createError, getRequestHeaders } from 'h3'
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
  | 'unknown'

export interface YouTubeTranscriptErrorData {
  transcriptFailed: true
  reasonCode: TranscriptFailureReason
  userMessage: string
  suggestAccountLink?: boolean
  canRetry?: boolean
  videoId: string
  workerError?: string
}

interface IngestYouTubeOptions {
  event: H3Event
  db: NodePgDatabase<typeof schema>
  sourceContentId: string
  organizationId: string
  userId: string
  videoId: string
}

interface WorkerTranscriptResponse {
  success: boolean
  transcript?: {
    text: string
    format: string
    language?: string | null
    track_kind?: string | null
  }
  metadata?: {
    client_version?: string | null
    method?: string | null
    video_id?: string
  }
  error?: {
    code?: string
    message?: string
    details?: string
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

function _classifyTranscriptFailure(message: string) {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('no captions') || lowerMessage.includes('no transcripts')) {
    return { reasonCode: 'no_captions' as const, userMessage: 'This video doesn\'t have captions available.', canRetry: false }
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

function mapWorkerError(code: string | undefined, statusCode?: number) {
  if (statusCode === 401) {
    return { reasonCode: 'auth_failed' as const, userMessage: 'Authentication required to fetch YouTube transcript. Please sign in again.' }
  }
  if (statusCode === 429 || code === 'rate_limited') {
    return { reasonCode: 'rate_limited' as const, userMessage: 'Too many requests, please try again later.', canRetry: true }
  }
  switch (code) {
    case 'no_captions':
      return { reasonCode: 'no_captions' as const, userMessage: 'This video doesn\'t have captions available.', canRetry: false }
    case 'invalid_video':
      return { reasonCode: 'private_or_unavailable' as const, userMessage: 'Invalid or unavailable YouTube video.' }
    case 'blocked':
      return { reasonCode: 'blocked' as const, userMessage: 'YouTube is blocking requests from our servers.' }
    case 'network_error':
      return { reasonCode: 'unknown' as const, userMessage: 'Network error while fetching YouTube transcript. Please try again.' }
    case 'internal_error':
      return { reasonCode: 'unknown' as const, userMessage: 'Internal error while fetching YouTube transcript.' }
    default:
      break
  }

  if (statusCode === 400) {
    return { reasonCode: 'private_or_unavailable' as const, userMessage: 'Unable to fetch transcript for this video.' }
  }

  return { reasonCode: 'unknown' as const, userMessage: 'Unable to fetch transcript.' }
}

class WorkerTranscriptError extends Error {
  failure: { reasonCode: TranscriptFailureReason, userMessage: string, canRetry?: boolean }
  statusCode?: number

  constructor(message: string, failure: { reasonCode: TranscriptFailureReason, userMessage: string, canRetry?: boolean }, statusCode?: number) {
    super(message)
    this.failure = failure
    this.statusCode = statusCode
  }
}

async function fetchTranscriptViaWorker(event: H3Event, videoId: string) {
  const headers: Record<string, string> = {}
  const requestHeaders = getRequestHeaders(event) || {}

  if (typeof requestHeaders.cookie === 'string' && requestHeaders.cookie) {
    headers.cookie = requestHeaders.cookie
  }

  if (typeof requestHeaders.authorization === 'string' && requestHeaders.authorization) {
    headers.authorization = requestHeaders.authorization
  }

  try {
    const response = await $fetch<WorkerTranscriptResponse>(`${runtimeConfig.workerApiUrl}/api/proxy/youtube-transcript`, {
      method: 'POST',
      body: { video_id: videoId },
      headers
    })

    if (!response?.success) {
      const failure = mapWorkerError(response?.error?.code, undefined)
      throw new WorkerTranscriptError(response?.error?.message || 'Failed to fetch transcript via Worker.', failure)
    }

    if (!response.transcript?.text) {
      throw new WorkerTranscriptError('Worker returned empty transcript content.', mapWorkerError('internal_error'))
    }

    return {
      text: response.transcript.text,
      format: response.transcript.format,
      language: response.transcript.language,
      trackKind: response.transcript.track_kind,
      metadata: response.metadata
    }
  } catch (error: any) {
    if (error instanceof WorkerTranscriptError) {
      throw error
    }

    const statusCode = (error as FetchError)?.statusCode
    const code = (error as FetchError)?.data?.error?.code as string | undefined
    const message = (error as FetchError)?.data?.error?.message || (error as Error).message || 'Failed to fetch transcript via Worker.'
    const failure = mapWorkerError(code, statusCode)
    throw new WorkerTranscriptError(message, failure, statusCode)
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
  const { event, db, sourceContentId, organizationId: _organizationId, userId: _userId, videoId } = options

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
  const ingestMethod = 'youtube_worker'

  try {
    const workerResult = await fetchTranscriptViaWorker(event, videoId)
    transcriptText = workerResult.text
    youtubeMetadata = {
      ...youtubeMetadata,
      transcriptMethod: 'worker',
      language: workerResult.language,
      trackKind: workerResult.trackKind,
      transcriptFormat: workerResult.format,
      workerMetadata: workerResult.metadata,
      lastIngestedAt: new Date().toISOString()
    }
  } catch (error) {
    // Worker handles all fallbacks internally, so if it fails, surface the error clearly
    const workerError = error as WorkerTranscriptError | Error
    const failure = (workerError instanceof WorkerTranscriptError)
      ? workerError.failure
      : mapWorkerError(undefined, (error as FetchError)?.statusCode)

    const errorMessage = (workerError instanceof WorkerTranscriptError)
      ? workerError.message
      : (error as Error).message || 'Failed to fetch transcript from Worker API'

    await db
      .update(schema.sourceContent)
      .set({
        ingestStatus: 'failed',
        metadata: {
          ...baseMetadata,
          ingestMethod,
          youtube: {
            ...youtubeMetadata,
            lastError: errorMessage,
            lastIngestedAt: new Date().toISOString()
          }
        },
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, sourceContentId))

    throw createTranscriptError({
      ...failure,
      videoId,
      workerError: errorMessage,
      suggestAccountLink: failure.reasonCode === 'auth_failed' || failure.reasonCode === 'permission_denied'
    })
  }

  const metadata = {
    ...baseMetadata,
    ingestMethod,
    youtube: youtubeMetadata
  }

  const [processing] = await db
    .update(schema.sourceContent)
    .set({
      sourceText: transcriptText,
      ingestStatus: 'processing',
      metadata,
      updatedAt: new Date()
    })
    .where(eq(schema.sourceContent.id, sourceContentId))
    .returning()

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
