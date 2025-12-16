import { and, desc, eq, lt, or } from 'drizzle-orm'
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

/**
 * Lists content for the organization with pagination
 *
 * @description Returns paginated content records with formatted display labels
 *
 * @returns Paginated array of content records
 */
export default defineEventHandler(async (event) => {
  try {
    const user = await requireAuth(event)
    const { organizationId } = await requireActiveOrganization(event, user.id)

    const query = await getValidatedQuery(event, querySchema.parse)
    const db = await useDB(event)

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

    const whereClauses = [eq(schema.content.organizationId, organizationId)]
    if (cursorDate && cursorId) {
      whereClauses.push(or(
        lt(schema.content.updatedAt, cursorDate),
        and(
          eq(schema.content.updatedAt, cursorDate),
          lt(schema.content.id, cursorId)
        )
      ))
    }

    const whereClause = whereClauses.length === 1 ? whereClauses[0] : and(...whereClauses)

    const results = await db
      .select({
        id: schema.content.id,
        title: schema.content.title,
        updatedAt: schema.content.updatedAt
      })
      .from(schema.content)
      .where(whereClause)
      .orderBy(desc(schema.content.updatedAt), desc(schema.content.id))
      .limit(query.limit + 1)

    const hasMore = results.length > query.limit
    const contents = hasMore ? results.slice(0, query.limit) : results

    for (const content of contents) {
      const updatedAtDate = content.updatedAt instanceof Date ? content.updatedAt : new Date(content.updatedAt)
      if (Number.isNaN(updatedAtDate.getTime())) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error',
          message: 'Invalid updatedAt value in database'
        })
      }
    }

    let nextCursor: string | null = null
    if (hasMore && contents.length > 0) {
      const last = contents[contents.length - 1]
      const updatedAtDate = last.updatedAt instanceof Date ? last.updatedAt : new Date(last.updatedAt)
      nextCursor = encodeCursor({
        id: last.id,
        updatedAt: updatedAtDate.toISOString()
      })
    }

    return {
      contents: contents.map((content) => {
        const updatedAtDate = content.updatedAt instanceof Date ? content.updatedAt : new Date(content.updatedAt)
        const rawTitle = typeof content.title === 'string' ? content.title.trim() : ''
        return {
          id: content.id,
          displayLabel: rawTitle || 'Untitled content',
          updatedAgo: formatUpdatedAgo(updatedAtDate)
        }
      }),
      nextCursor,
      hasMore,
      limit: query.limit
    }
  } catch (error) {
    console.error('[Content API] Error caught:', error)
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
