import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FetchError } from 'ofetch'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import * as schema from '../../database/schema'
import { createChunksFromSourceContentText } from './chunkSourceContent'

const TOKEN_REFRESH_BUFFER_MS = 60_000

interface IngestYouTubeOptions {
  db: NodePgDatabase<typeof schema>
  sourceContentId: string
  organizationId: string
  userId: string
  videoId: string
}

function hasYouTubeScopes(scope: string | null | undefined) {
  if (!scope) {
    return false
  }
  // Check for full YouTube API scope URLs (more explicit and reliable)
  return scope.includes('https://www.googleapis.com/auth/youtube') ||
    scope.includes('https://www.googleapis.com/auth/youtube.force-ssl')
}

function stripVttToPlainText(vtt: string) {
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

async function fetchInnertubeClientConfig(videoId: string) {
  const watchPage = await $fetch<string>(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
    responseType: 'text'
  })

  const apiKey = watchPage.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const clientVersion = watchPage.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]

  if (!apiKey || !clientVersion) {
    throw new Error('Unable to extract YouTube client configuration for transcript fetch.')
  }

  return { apiKey, clientVersion }
}

function selectPreferredCaptionTrack(tracks: any[]) {
  const englishNonAsr = tracks.find(track => track?.languageCode?.startsWith('en') && track?.kind !== 'asr')
  if (englishNonAsr)
    return englishNonAsr

  const nonAsr = tracks.find(track => track?.kind !== 'asr')
  if (nonAsr)
    return nonAsr

  return tracks[0]
}

function parseJson3Transcript(json: any) {
  const events = Array.isArray(json?.events) ? json.events : []
  const segments = events
    .flatMap((event: any) => Array.isArray(event?.segs) ? event.segs : [])
    .map((segment: any) => typeof segment?.utf8 === 'string' ? segment.utf8 : '')
    .filter(Boolean)

  return segments.join(' ').replace(/\s+/g, ' ').trim()
}

async function downloadInnertubeTranscript(track: any) {
  if (!track || typeof track.baseUrl !== 'string' || !track.baseUrl.trim()) {
    throw new Error('Invalid Innertube caption track: baseUrl is missing or empty.')
  }

  let trackUrl: URL
  try {
    trackUrl = new URL(track.baseUrl)
  } catch (error) {
    throw new Error(`Invalid Innertube caption track baseUrl: ${(error as Error).message}`)
  }
  trackUrl.searchParams.set('fmt', 'json3')

  try {
    const json = await $fetch<any>(trackUrl.toString())
    const text = parseJson3Transcript(json)
    if (text) {
      return { text, format: 'json3' as const }
    }
  } catch (error) {
    console.warn('Failed to parse JSON3 transcript, falling back to VTT', error)
  }

  trackUrl.searchParams.set('fmt', 'vtt')
  const vtt = await $fetch<string>(trackUrl.toString(), { responseType: 'text' })
  const text = stripVttToPlainText(vtt)
  if (!text) {
    throw new Error('Transcript download returned empty content.')
  }
  return { text, format: 'vtt' as const }
}

async function fetchTranscriptViaInnertube(videoId: string) {
  const { apiKey, clientVersion } = await fetchInnertubeClientConfig(videoId)

  const playerResponse = await $fetch<any>(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    body: {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'WEB',
          clientVersion
        }
      },
      videoId
    }
  })

  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!Array.isArray(tracks) || !tracks.length) {
    throw new Error('No transcripts available via YouTube web client.')
  }

  const track = selectPreferredCaptionTrack(tracks)

  const { text, format } = await downloadInnertubeTranscript(track)

  return {
    text,
    track,
    format,
    clientVersion
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

async function downloadCaption(accessToken: string, captionId: string) {
  try {
    return await $fetch<string>(`https://youtube.googleapis.com/youtube/v3/captions/${captionId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/plain'
      },
      query: {
        tfmt: 'vtt',
        alt: 'media'
      },
      responseType: 'text'
    })
  } catch (error: any) {
    // Provide more helpful error messages for caption download errors
    if (error?.statusCode === 403 || error?.data?.error?.code === 403) {
      throw new Error('Permission denied when downloading captions. Please ensure you have access to manage this video\'s captions.')
    }
    if (error?.statusCode === 401 || error?.data?.error?.code === 401) {
      throw new Error('Authentication failed when downloading captions. The access token may be invalid or expired.')
    }
    throw error
  }
}

async function fetchCaptionMetadata(accessToken: string, videoId: string) {
  try {
    const response = await $fetch<any>('https://youtube.googleapis.com/youtube/v3/captions', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        part: 'id,snippet',
        videoId
      }
    })

    const items = response?.items || []
    if (!items.length) {
      throw new Error('No captions available for this video. The video may not have captions, or you may not have permission to access them. Note: You must own the video or have been granted caption management access.')
    }

    const preferred = items.find((item: any) => item?.snippet?.language?.startsWith('en') && item?.snippet?.trackKind !== 'ASR')
      || items.find((item: any) => item?.snippet?.trackKind !== 'ASR')
      || items[0]

    return preferred
  } catch (error: any) {
    // Provide more helpful error messages for common API errors
    if (error?.statusCode === 403 || error?.data?.error?.code === 403) {
      throw new Error('Permission denied. You must own the YouTube video or have been granted caption management access. The YouTube Data API v3 requires ownership or explicit permission to access captions.')
    }
    if (error?.statusCode === 401 || error?.data?.error?.code === 401) {
      throw new Error('Authentication failed. The access token may be invalid or expired. Please reconnect your YouTube integration.')
    }
    if (error?.statusCode === 404 || error?.data?.error?.code === 404) {
      throw new Error('Video not found. Please verify the video ID is correct and the video exists.')
    }
    // Re-throw with original message if it's a different error
    throw error
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
  const { db, sourceContentId, organizationId, userId, videoId } = options

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
  let lastInnertubeError: string | undefined
  let ingestMethod: string | null = typeof (baseMetadata as any)?.ingestMethod === 'string'
    ? (baseMetadata as any).ingestMethod
    : null

  try {
    const innertubeResult = await fetchTranscriptViaInnertube(videoId)
    transcriptText = innertubeResult.text
    ingestMethod = 'youtube_innertube'
    youtubeMetadata = {
      ...youtubeMetadata,
      transcriptMethod: 'innertube',
      language: innertubeResult.track?.languageCode ?? innertubeResult.track?.languageName,
      trackKind: innertubeResult.track?.kind,
      transcriptFormat: innertubeResult.format,
      clientVersion: innertubeResult.clientVersion,
      lastIngestedAt: new Date().toISOString()
    }
  } catch (error) {
    lastInnertubeError = (error as Error).message
    console.warn('Innertube transcript fetch failed, falling back to YouTube API', error)
  }

  if (!transcriptText) {
    const account = await findYouTubeAccount(db, organizationId, userId)

    if (!account) {
      await db
        .update(schema.sourceContent)
        .set({
          ingestStatus: 'failed',
          metadata: {
            ...baseMetadata,
            ingestMethod,
            youtube: {
              ...youtubeMetadata,
              lastError: 'No connected YouTube integration available.',
              lastInnertubeError
            }
          },
          updatedAt: new Date()
        })
        .where(eq(schema.sourceContent.id, sourceContentId))
      throw createError({
        statusCode: 400,
        statusMessage: 'No YouTube integration available for this organization.'
      })
    }

    try {
      const accessToken = await ensureAccessToken(db, account)
      const caption = await fetchCaptionMetadata(accessToken, videoId)
      const vttContent = await downloadCaption(accessToken, caption.id)
      transcriptText = stripVttToPlainText(vttContent)
      ingestMethod = 'youtube_api'
      youtubeMetadata = {
        ...youtubeMetadata,
        transcriptMethod: 'youtube_api',
        captionId: caption.id,
        language: caption?.snippet?.language,
        lastIngestedAt: new Date().toISOString(),
        lastInnertubeError
      }
    } catch (error) {
      const errorMessage = (error as FetchError)?.data?.error?.message || (error as Error).message || 'Unknown ingest error'
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
              lastInnertubeError,
              lastIngestedAt: new Date().toISOString()
            }
          },
          updatedAt: new Date()
        })
        .where(eq(schema.sourceContent.id, sourceContentId))

      throw error
    }
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
