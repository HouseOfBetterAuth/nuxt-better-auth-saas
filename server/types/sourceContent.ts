import type { INGEST_STATUSES } from '~~/server/services/sourceContent'

/**
 * Ingest status values
 */
export type IngestStatus = typeof INGEST_STATUSES[number]

/**
 * Request body for creating source content from context
 */
export interface CreateSourceContentFromContextRequestBody {
  /** Raw context text (required) */
  context: string
  /** Optional title for the source content */
  title?: string | null
  /** Optional metadata */
  metadata?: Record<string, any> | null
}

/**
 * Request body for ingesting YouTube video as source content
 */
export interface IngestYouTubeVideoAsSourceContentRequestBody {
  /** YouTube video URL (required) */
  youtubeUrl: string
  /** Optional title hint */
  titleHint?: string | null
}

/**
 * Source content record for API responses
 *
 * @description Timestamps are strings (ISO 8601) for JSON serialization compatibility
 */
export interface SourceContent {
  id: string
  organizationId: string
  sourceType: string
  externalId: string | null
  title: string | null
  ingestStatus: IngestStatus
  createdAt: string // ISO 8601 string for JSON serialization
  updatedAt: string // ISO 8601 string for JSON serialization
}

/**
 * Response from ingesting YouTube video
 */
export interface IngestYouTubeVideoAsSourceContentResponse {
  /** ID of the created/updated source content */
  sourceContentId: string
  /** Current ingest status */
  ingestStatus: IngestStatus
  /** The source content record */
  sourceContent: SourceContent
}

/**
 * Request body for creating/updating source content
 */
export interface UpsertSourceContentRequestBody {
  /** Type of source (youtube, manual_transcript, etc.) */
  sourceType: string
  /** External ID (e.g., YouTube video ID) */
  externalId?: string | null
  /** Title of the source content */
  title?: string | null
  /** Source text/context */
  sourceText?: string | null
  /** Metadata */
  metadata?: Record<string, any> | null
  /** Ingest status */
  ingestStatus?: IngestStatus
}
