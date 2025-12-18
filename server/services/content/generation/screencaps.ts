import type { ImageSuggestion } from './types'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createError } from 'h3'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { safeWarn } from '~~/server/utils/safeLogger'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 45_000

const formatTimestampForName = (timestampSeconds?: number | null) => {
  const fallback = 0
  const normalized = typeof timestampSeconds === 'number' && Number.isFinite(timestampSeconds)
    ? Math.max(0, timestampSeconds)
    : fallback

  const trimmed = Number(normalized.toFixed(3))
  const stringValue = trimmed % 1 === 0
    ? Math.trunc(trimmed).toString()
    : trimmed.toString()

  return stringValue.replace(/\./g, '-')
}

export const buildScreencapFileName = (
  videoId: string,
  timestampSeconds?: number | null,
  isThumbnail?: boolean
) => {
  const timestampPart = formatTimestampForName(timestampSeconds || 0)
  const suffix = isThumbnail ? '-thumb' : ''
  return `screencap-${videoId}-${timestampPart}s${suffix}.jpg`
}

const ensureBinaryAvailable = async (binary: string) => {
  try {
    await execFileAsync(binary, ['--version'], { timeout: 5_000 })
    return true
  } catch (error) {
    safeWarn('[screencaps] Required binary missing', { binary, error })
    throw createError({
      statusCode: 500,
      statusMessage: `${binary} is required for screencap extraction`
    })
  }
}

const runCommand = async (command: string, args: string[], timeoutMs?: number) => {
  return await execFileAsync(command, args, {
    timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 32
  })
}

export type ScreencapVariant = 'thumbnail' | 'full'

export const extractScreencapFromYouTube = async (params: {
  videoId: string
  timestampSeconds?: number | null
  variant?: ScreencapVariant
  timeoutMs?: number
}) => {
  const { videoId, timestampSeconds, variant = 'full', timeoutMs } = params

  if (!videoId || !videoId.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Video ID is required for screencap extraction'
    })
  }

  await ensureBinaryAvailable('yt-dlp')
  await ensureBinaryAvailable('ffmpeg')

  const timestamp = typeof timestampSeconds === 'number' && Number.isFinite(timestampSeconds)
    ? Math.max(0, timestampSeconds)
    : 0

  const tempDir = await mkdtemp(join(tmpdir(), 'screencap-'))
  const videoPath = join(tempDir, `${videoId}-${randomUUID()}.mp4`)
  const imagePath = join(tempDir, `${variant}-frame.jpg`)

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`

    await runCommand('yt-dlp', [
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '-f',
      'mp4/best',
      '-o',
      videoPath,
      videoUrl
    ], timeoutMs)

    const filterArgs = variant === 'thumbnail'
      ? [
          '-vf',
          'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2'
        ]
      : []

    await runCommand('ffmpeg', [
      '-ss',
      timestamp.toString(),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      ...filterArgs,
      '-y',
      imagePath
    ], timeoutMs)

    const buffer = await readFile(imagePath)
    const fileName = buildScreencapFileName(videoId, timestamp, variant === 'thumbnail')

    return {
      buffer,
      mimeType: 'image/jpeg',
      fileName,
      timestamp
    }
  } catch (error) {
    safeWarn('[screencaps] Extraction failed', {
      videoId,
      timestampSeconds,
      variant,
      error
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to extract screencap from YouTube'
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export const attachThumbnailsToSuggestions = async (params: {
  suggestions: ImageSuggestion[]
  contentId: string
  userId?: string
}) => {
  const { suggestions, contentId, userId } = params
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return suggestions
  }

  const storageConfig = useFileManagerConfig()
  const storageProvider = await createStorageProvider(storageConfig.storage)
  const fileService = new FileService(storageProvider)

  const results: ImageSuggestion[] = []

  for (const suggestion of suggestions) {
    const baseStatus = suggestion.status ?? (suggestion.type === 'screencap' ? 'pending' : undefined)
    if (suggestion.type !== 'screencap' || !suggestion.videoId) {
      results.push({ ...suggestion, status: baseStatus })
      continue
    }

    try {
      const extraction = await extractScreencapFromYouTube({
        videoId: suggestion.videoId,
        timestampSeconds: suggestion.estimatedTimestamp ?? 0,
        variant: 'thumbnail'
      })

      const uploaded = await fileService.uploadFile(
        extraction.buffer,
        extraction.fileName,
        extraction.mimeType,
        userId,
        undefined,
        undefined,
        {
          fileName: extraction.fileName,
          overrideOriginalName: extraction.fileName,
          contentId
        }
      )

      results.push({
        ...suggestion,
        thumbnailFileId: uploaded.id,
        thumbnailUrl: uploaded.url || uploaded.path,
        status: 'thumbnail_ready'
      })
    } catch (error) {
      safeWarn('[screencaps] Failed to prepare thumbnail', {
        videoId: suggestion.videoId,
        error
      })
      results.push({
        ...suggestion,
        status: baseStatus
      })
    }
  }

  return results
}
