import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { CONTENT_TYPES } from '~~/shared/constants/contentTypes'
import * as schema from '../database/schema'

export const CONTENT_STATUSES = ['draft', 'in_review', 'ready_for_publish', 'published', 'archived'] as const
export { CONTENT_TYPES }

const UNIQUE_SLUG_CONSTRAINTS = ['content_org_slug_idx']

const normalizeToSlug = (input: string) => {
  if (!input || !input.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Input is required for slug generation'
    })
  }

  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized || !normalized.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Input cannot be converted to a valid slug'
    })
  }

  return normalized
}

export const slugifyTitle = (input: string) => {
  return normalizeToSlug(input)
}

export const ensureUniqueContentSlug = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  candidate: string
) => {
  if (!candidate || !candidate.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Slug candidate is required'
    })
  }

  let slug = slugifyTitle(candidate)
  let attempt = 0
  const maxAttempts = 5

  while (attempt < maxAttempts) {
    const existing = await db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(and(
        eq(schema.content.organizationId, organizationId),
        eq(schema.content.slug, slug)
      ))
      .limit(1)

    if (existing.length === 0) {
      return slug
    }

    attempt += 1
    const suffix = Math.random().toString(36).slice(2, 6)
    const candidateWithSuffix = `${candidate}-${suffix}`
    slug = slugifyTitle(candidateWithSuffix)
  }

  throw createError({
    statusCode: 500,
    statusMessage: `Unable to generate a unique slug after ${maxAttempts} attempts`
  })
}

export const isContentSlugConstraintError = (error: any) => {
  return Boolean(
    error &&
    error.code === '23505' &&
    typeof error.constraint === 'string' &&
    UNIQUE_SLUG_CONSTRAINTS.includes(error.constraint)
  )
}

export const resolveIngestMethodFromSourceContent = (
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
): string | null => {
  if (!sourceContent) {
    return null
  }

  const metadata = sourceContent.metadata as Record<string, any> | null
  const ingestMethod = metadata?.ingestMethod
  const youtubeMethod = metadata?.youtube?.transcriptMethod
  const origin = metadata?.origin

  if (typeof ingestMethod === 'string' && ingestMethod.trim()) {
    return ingestMethod
  }

  if (typeof youtubeMethod === 'string' && youtubeMethod.trim()) {
    return youtubeMethod
  }

  if (typeof origin === 'string' && origin.trim()) {
    return origin
  }

  if (typeof sourceContent.sourceType === 'string' && sourceContent.sourceType.trim()) {
    return sourceContent.sourceType
  }

  return null
}
