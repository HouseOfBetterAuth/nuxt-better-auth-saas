import type * as schema from '~~/server/db/schema'
import type { ContentFrontmatter, ContentGenerationOverrides, ContentOutline } from './types'
import { createError } from 'h3'
import { CONTENT_STATUSES, CONTENT_TYPES, slugifyTitle } from '~~/server/utils/content'
import { validateEnum } from '~~/server/utils/validation'
import { normalizeContentKeywords, normalizeContentSchemaTypes } from './utils'

const CONTENT_TYPE_SCHEMA_EXTENSIONS: Partial<Record<typeof CONTENT_TYPES[number], string[]>> = {
  recipe: ['Recipe'],
  how_to: ['HowTo'],
  faq_page: ['FAQPage'],
  course: ['Course']
}

const FRONTMATTER_KEY_ORDER = [
  'title',
  'seoTitle',
  'description',
  'slug',
  'contentType',
  'targetLocale',
  'status',
  'primaryKeyword',
  'keywords',
  'tags',
  'schemaTypes',
  'sourceContentId'
]

export const createFrontmatterFromOutline = (params: {
  plan: ContentOutline
  overrides?: ContentGenerationOverrides
  existingContent?: typeof schema.content.$inferSelect | null
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}): ContentFrontmatter => {
  const { plan, overrides, existingContent, sourceContent } = params

  if (!plan.seo.title || !plan.seo.title.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Plan must include a title'
    })
  }

  const resolvedTitle = overrides?.title?.trim() || plan.seo.title
  if (!resolvedTitle || !resolvedTitle.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Title is required. Provide a title in overrides or ensure the plan includes one.'
    })
  }

  const slugInput = overrides?.slug?.trim() || plan.seo.slugSuggestion
  if (!slugInput || !slugInput.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Slug is required. Provide a slug in overrides or ensure the plan includes slugSuggestion.'
    })
  }
  const normalizedSlug = slugifyTitle(slugInput.trim())

  // For new content, default to 'draft'. For existing content, require explicit status or use existing.
  let statusCandidate: typeof CONTENT_STATUSES[number]
  if (overrides?.status) {
    statusCandidate = validateEnum(overrides.status, CONTENT_STATUSES, 'status')
  } else if (existingContent?.status) {
    statusCandidate = validateEnum(existingContent.status, CONTENT_STATUSES, 'status')
  } else {
    // New content defaults to 'draft' - this is a business rule, not a fallback
    statusCandidate = 'draft'
  }

  // contentType must always be provided explicitly or exist on existing content
  let contentTypeCandidate: typeof CONTENT_TYPES[number]
  if (overrides?.contentType) {
    contentTypeCandidate = validateEnum(overrides.contentType, CONTENT_TYPES, 'contentType')
  } else if (existingContent?.contentType) {
    contentTypeCandidate = validateEnum(existingContent.contentType, CONTENT_TYPES, 'contentType')
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: `contentType is required and must be one of: ${CONTENT_TYPES.join(', ')}`
    })
  }

  const resolvedSchemaTypes = normalizeContentSchemaTypes(
    params.plan.seo.schemaTypes,
    params.plan.seo.schemaType,
    overrides?.schemaTypes,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[contentTypeCandidate]
  )

  if (resolvedSchemaTypes.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Schema types are required'
    })
  }

  const keywordSet = new Set<string>()
  for (const keyword of normalizeContentKeywords(plan.seo.keywords)) {
    keywordSet.add(keyword)
  }
  const resolvedPrimaryKeyword = overrides?.primaryKeyword ?? existingContent?.primaryKeyword ?? plan.seo.keywords?.[0] ?? null
  if (resolvedPrimaryKeyword) {
    keywordSet.add(resolvedPrimaryKeyword)
  }

  return {
    title: resolvedTitle.trim(),
    description: plan.seo.description || undefined,
    slug: normalizedSlug,
    slugSuggestion: normalizedSlug,
    tags: Array.from(keywordSet),
    keywords: Array.from(keywordSet),
    status: statusCandidate,
    contentType: contentTypeCandidate,
    schemaTypes: resolvedSchemaTypes,
    primaryKeyword: resolvedPrimaryKeyword,
    targetLocale: overrides?.targetLocale ?? existingContent?.targetLocale ?? null,
    sourceContentId: sourceContent?.id ?? existingContent?.sourceContentId ?? null
  }
}

export const enrichFrontmatterWithMetadata = (params: {
  plan: ContentOutline
  frontmatter: ContentFrontmatter
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}) => {
  const { plan, frontmatter, sourceContent: _sourceContent } = params
  const title = (frontmatter.title || '').replace(/\s+/g, ' ').trim()
  if (!title) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Title is required in frontmatter'
    })
  }
  const slugCandidate = frontmatter.slug || frontmatter.slugSuggestion || title
  const slug = slugifyTitle(slugCandidate)

  const keywordSet = new Set<string>()
  const push = (value?: string | null) => {
    const trimmed = (value || '').trim()
    if (trimmed) {
      keywordSet.add(trimmed)
    }
  }
  const pushMany = (values?: string[] | null) => {
    for (const value of values || []) {
      push(value)
    }
  }

  push(frontmatter.primaryKeyword)
  pushMany(frontmatter.tags)
  pushMany(frontmatter.keywords)
  pushMany(plan.seo.keywords)

  const resolvedSchemaTypes = normalizeContentSchemaTypes(
    frontmatter.schemaTypes,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[frontmatter.contentType]
  )

  return {
    ...frontmatter,
    title,
    slug,
    slugSuggestion: frontmatter.slugSuggestion || slug,
    tags: Array.from(keywordSet),
    keywords: Array.from(keywordSet),
    description: frontmatter.description || plan.seo.description,
    schemaTypes: resolvedSchemaTypes,
    targetLocale: frontmatter.targetLocale || null
  }
}

export const extractFrontmatterFromVersion = (params: {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect | null
}): ContentFrontmatter => {
  const versionFrontmatter = params.version?.frontmatter || {}

  const resolvedTitle = versionFrontmatter.title || params.content.title
  if (!resolvedTitle || !resolvedTitle.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content title is required'
    })
  }

  const slugInput = versionFrontmatter.slug || params.content.slug
  if (!slugInput || !slugInput.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content slug is required'
    })
  }

  const statusCandidate = versionFrontmatter.status
    ? validateEnum(versionFrontmatter.status, CONTENT_STATUSES, 'status')
    : validateEnum(params.content.status, CONTENT_STATUSES, 'status')

  const contentTypeCandidate = versionFrontmatter.contentType
    ? validateEnum(versionFrontmatter.contentType, CONTENT_TYPES, 'contentType')
    : validateEnum(params.content.contentType, CONTENT_TYPES, 'contentType')
  const schemaTypes = normalizeContentSchemaTypes(
    versionFrontmatter.schemaTypes,
    versionFrontmatter.schemaType,
    CONTENT_TYPE_SCHEMA_EXTENSIONS[contentTypeCandidate]
  )

  return {
    title: resolvedTitle.trim(),
    description: versionFrontmatter.description || undefined,
    slug: slugifyTitle(slugInput.trim()),
    slugSuggestion: slugifyTitle(slugInput.trim()),
    tags: Array.isArray(versionFrontmatter.tags) ? normalizeContentKeywords(versionFrontmatter.tags) : undefined,
    keywords: normalizeContentKeywords(versionFrontmatter.keywords || versionFrontmatter.tags || []),
    status: statusCandidate,
    contentType: contentTypeCandidate,
    schemaTypes,
    primaryKeyword: versionFrontmatter.primaryKeyword ?? params.content.primaryKeyword ?? null,
    targetLocale: versionFrontmatter.targetLocale ?? params.content.targetLocale ?? null,
    sourceContentId: versionFrontmatter.sourceContentId ?? params.content.sourceContentId ?? null
  }
}

function formatYamlScalar(value: any, indent = 0): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\r/g, '')
    if (normalized.includes('\n')) {
      const blockIndent = '  '.repeat(indent + 1)
      const indented = normalized.split('\n').map(line => `${blockIndent}${line}`).join('\n')
      return `|\n${indented}`
    }
    return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return JSON.stringify(value)
}

function formatFrontmatterAsYamlLines(value: any, indent = 0): string[] {
  const prefix = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) {
      return [`${prefix}[]`]
    }
    return value.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}-`, ...formatFrontmatterAsYamlLines(entry, indent + 1)]
      }
      return [`${prefix}- ${formatYamlScalar(entry, indent)}`]
    })
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, any>)
    if (!entries.length) {
      return [`${prefix}{}`]
    }
    return entries.flatMap(([key, entry]) => {
      if (entry && typeof entry === 'object') {
        return [`${prefix}${key}:`, ...formatFrontmatterAsYamlLines(entry, indent + 1)]
      }
      return [`${prefix}${key}: ${formatYamlScalar(entry, indent)}`]
    })
  }
  return [`${prefix}${formatYamlScalar(value, indent)}`]
}

export function orderFrontmatterKeys(frontmatter: Record<string, any>) {
  const ordered: Record<string, any> = {}
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (frontmatter[key] !== undefined) {
      ordered[key] = frontmatter[key]
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (ordered[key] === undefined) {
      ordered[key] = value
    }
  }
  return ordered
}

export function formatFrontmatterAsYaml(frontmatter: Record<string, any> | null | undefined) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return '---\n---'
  }
  const filtered = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0
      }
      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0
      }
      return value !== null && value !== undefined && value !== ''
    })
  )
  const ordered = orderFrontmatterKeys(filtered)
  const lines = formatFrontmatterAsYamlLines(ordered)
  return ['---', ...lines, '---'].join('\n')
}
