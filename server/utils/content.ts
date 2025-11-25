import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { CONTENT_TYPES } from '~~/shared/constants/contentTypes'
import * as schema from '../database/schema'

export const CONTENT_STATUSES = ['draft', 'in_review', 'ready_for_publish', 'published', 'archived'] as const
export { CONTENT_TYPES }

const FALLBACK_SLUG = 'untitled'
const UNIQUE_SLUG_CONSTRAINTS = ['content_org_slug_idx']

const normalizeToSlug = (input: string) => {
  if (!input) {
    return ''
  }

  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const slugifyTitle = (input: string) => {
  const normalized = normalizeToSlug(input || '')
  return normalized || FALLBACK_SLUG
}

const withFallbackSlug = (value: string) => {
  const normalized = normalizeToSlug(value)
  return normalized || `${FALLBACK_SLUG}-${Date.now()}`
}

export const ensureUniqueContentSlug = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  candidate: string
) => {
  let slug = slugifyTitle(candidate)
  let attempt = 0

  while (attempt < 5) {
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
    slug = withFallbackSlug(`${candidate}-${Math.random().toString(36).slice(2, 6)}`)
  }

  return withFallbackSlug(`${candidate}-${Date.now()}`)
}

export const isContentSlugConstraintError = (error: any) => {
  return Boolean(
    error &&
    error.code === '23505' &&
    typeof error.constraint === 'string' &&
    UNIQUE_SLUG_CONSTRAINTS.includes(error.constraint)
  )
}
