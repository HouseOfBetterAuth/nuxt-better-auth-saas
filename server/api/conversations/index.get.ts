import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
})

interface CursorPayload {
  id: string
  updatedAt: string
}

const MAX_CURSOR_LENGTH = 2048

// Use Web APIs that work in both Node.js and Cloudflare Workers
const encodeCursor = (payload: CursorPayload) => {
  const json = JSON.stringify(payload)
  // Use TextEncoder for UTF-8 encoding, then convert to base64
  const encoder = new TextEncoder()
  const bytes = encoder.encode(json)
  // Convert bytes to base64 using btoa on the binary string
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const decodeCursor = (cursor: string): CursorPayload => {
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid cursor value'
    })
  }

  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const paddingNeeded = (4 - (base64.length % 4 || 4)) % 4
    const padded = `${base64}${'='.repeat(paddingNeeded)}`
    // Use atob to decode base64, then TextDecoder for UTF-8
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoder = new TextDecoder()
    const json = decoder.decode(bytes)
    const parsed = JSON.parse(json) as CursorPayload
    if (!parsed?.id || !parsed?.updatedAt) {
      throw new Error('Invalid payload')
    }
    return parsed
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid cursor value'
    })
  }
}

const formatUpdatedAgo = (value: Date) => {
  const timestamp = value.getTime()
  if (Number.isNaN(timestamp))
    return 'Just now'

  const diffMs = Date.now() - timestamp
  if (diffMs <= 0)
    return 'Just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60)
    return 'Just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7)
    return `${days}d ago`

  const currentYear = new Date().getFullYear()
  const dateYear = value.getFullYear()
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(dateYear !== currentYear ? { year: 'numeric' } : {})
  })
  return formatter.format(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const toNonNegativeInteger = (value: unknown): number => {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(numeric))
    return 0
  return Math.max(0, Math.trunc(numeric))
}

const parseDiffStats = (value: unknown): { additions: number, deletions: number } => {
  if (!value)
    return { additions: 0, deletions: 0 }

  const candidate = (() => {
    if (isRecord(value))
      return value
    if (typeof value !== 'string')
      return null
    try {
      const parsed = JSON.parse(value) as unknown
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  })()

  if (!candidate)
    return { additions: 0, deletions: 0 }

  return {
    additions: toNonNegativeInteger(candidate.additions),
    deletions: toNonNegativeInteger(candidate.deletions)
  }
}

export default defineEventHandler(async (event) => {
  try {
    console.log('[Conversations API] Starting request')
    const user = await requireAuth(event, { allowAnonymous: true })
    console.log('[Conversations API] User authenticated:', { userId: user.id, isAnonymous: user.isAnonymous })

    const { organizationId } = await requireActiveOrganization(event)
    console.log('[Conversations API] Organization resolved:', { organizationId })

    const query = await getValidatedQuery(event, querySchema.parse)
    console.log('[Conversations API] Query validated:', { limit: query.limit, hasCursor: !!query.cursor })

    const db = await useDB(event)
    console.log('[Conversations API] Database connection obtained')

    let cursorDate: Date | null = null
    let cursorId: string | null = null
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor)
      cursorId = decoded.id
      const parsedDate = new Date(decoded.updatedAt)
      if (Number.isNaN(parsedDate.getTime())) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          message: 'Invalid cursor value'
        })
      }
      cursorDate = parsedDate
    }

    const whereClauses = [eq(schema.conversation.organizationId, organizationId)]
    if (cursorDate && cursorId) {
      whereClauses.push(or(
        lt(schema.conversation.updatedAt, cursorDate),
        and(
          eq(schema.conversation.updatedAt, cursorDate),
          lt(schema.conversation.id, cursorId)
        )
      ))
    }

    const whereClause = whereClauses.length === 1 ? whereClauses[0] : and(...whereClauses)
    console.log('[Conversations API] Executing database query')

    const results = await db
      .select({
        id: schema.conversation.id,
        updatedAt: schema.conversation.updatedAt,
        title: sql<string | null>`NULLIF(${schema.conversation.metadata}->>'title', '')`,
        previewDiffStats: sql<unknown>`${schema.conversation.metadata}->'preview'->'diffStats'`
      })
      .from(schema.conversation)
      .where(whereClause)
      .orderBy(desc(schema.conversation.updatedAt), desc(schema.conversation.id))
      .limit(query.limit + 1)

    console.log('[Conversations API] Query completed:', { resultCount: results.length })

    const hasMore = results.length > query.limit
    const conversations = hasMore ? results.slice(0, query.limit) : results

    for (const conv of conversations) {
      const updatedAtDate = conv.updatedAt instanceof Date ? conv.updatedAt : new Date(conv.updatedAt)
      if (Number.isNaN(updatedAtDate.getTime())) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error',
          message: 'Invalid updatedAt value in database'
        })
      }
    }

    let nextCursor: string | null = null
    if (hasMore && conversations.length > 0) {
      const last = conversations[conversations.length - 1]
      const updatedAtDate = last.updatedAt instanceof Date ? last.updatedAt : new Date(last.updatedAt)
      nextCursor = encodeCursor({
        id: last.id,
        updatedAt: updatedAtDate.toISOString()
      })
    }

    return {
      conversations: conversations.map((conv) => {
        const updatedAtDate = conv.updatedAt instanceof Date ? conv.updatedAt : new Date(conv.updatedAt)
        const rawTitle = typeof conv.title === 'string' ? conv.title.trim() : ''
        const { additions, deletions } = parseDiffStats(conv.previewDiffStats)
        return {
          id: conv.id,
          displayLabel: rawTitle || 'Untitled conversation',
          updatedAgo: formatUpdatedAgo(updatedAtDate),
          additions,
          deletions
        }
      }),
      nextCursor,
      hasMore,
      limit: query.limit
    }
  } catch (error) {
    console.error('[Conversations API] Error caught:', error)
    if (error instanceof Error) {
      console.error('[Conversations API] Error name:', error.name)
      console.error('[Conversations API] Error message:', error.message)
      console.error('[Conversations API] Error stack:', error.stack)
    } else {
      console.error('[Conversations API] Error type:', typeof error)
      console.error('[Conversations API] Error value:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    }
    // Re-throw H3 errors as-is, wrap others
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const statusCode = isRecord(error) ? error.statusCode : undefined
      console.error('[Conversations API] Re-throwing H3 error with statusCode:', statusCode)
      throw error
    }
    console.error('[Conversations API] Wrapping error in createError')
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
