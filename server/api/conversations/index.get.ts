import { Buffer } from 'node:buffer'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
})

interface CursorPayload {
  id: string
  updatedAt: string
}

const MAX_CURSOR_LENGTH = 2048

const encodeCursor = (payload: CursorPayload) => {
  const base64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
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
    const json = Buffer.from(padded, 'base64').toString('utf8')
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

const deriveTitle = (metadata: Record<string, any> | null | undefined) => {
  if (metadata?.title) {
    return String(metadata.title)
  }
  const previewTitle = metadata?.preview?.latestArtifact?.title
  if (previewTitle) {
    return String(previewTitle)
  }
  return 'Untitled conversation'
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, { allowAnonymous: true })
  const { organizationId } = await requireActiveOrganization(event, user.id, {
    isAnonymousUser: Boolean(user.isAnonymous)
  })

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

  const filters = [eq(schema.conversation.organizationId, organizationId)]
  if (cursorDate && cursorId) {
    filters.push(or(
      lt(schema.conversation.updatedAt, cursorDate),
      and(
        eq(schema.conversation.updatedAt, cursorDate),
        lt(schema.conversation.id, cursorId)
      )
    ))
  }

  const whereClause = filters.length === 1 ? filters[0] : and(...filters)

  const results = await db
    .select({
      id: schema.conversation.id,
      metadata: schema.conversation.metadata,
      updatedAt: schema.conversation.updatedAt
    })
    .from(schema.conversation)
    .where(whereClause)
    .orderBy(desc(schema.conversation.updatedAt), desc(schema.conversation.id))
    .limit(query.limit + 1)

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
      return {
        id: conv.id,
        displayLabel: deriveTitle(conv.metadata),
        updatedAgo: formatUpdatedAgo(updatedAtDate)
      }
    }),
    nextCursor,
    hasMore,
    limit: query.limit
  }
})
