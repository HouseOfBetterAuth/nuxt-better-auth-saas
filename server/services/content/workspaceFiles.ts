import type * as schema from '~~/server/db/schema'
import type { ContentSection } from './generation/types'
import { slugifyTitle } from '~~/server/utils/content'
import { enrichMdxWithMetadata } from './generation'

export interface WorkspaceFilePayload {
  id: string
  filename: string
  body: string
  frontmatter: Record<string, any>
  wordCount: number
  sectionsCount: number
  seoSnapshot: Record<string, any> | null
  seoPlan: Record<string, any> | null
  frontmatterKeywords: string[]
  seoKeywords: string[]
  tags: string[]
  schemaTypes: string[]
  generatorDetails: Record<string, any> | null
  generatorStages: string[]
  sourceDetails: typeof schema.sourceContent.$inferSelect | null
  sourceLink: string | null
  fullMdx: string
}

const safeSlug = (input?: string | null) => {
  const trimmed = input?.trim()
  if (!trimmed) {
    return null
  }
  try {
    return slugifyTitle(trimmed)
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }
}

const sanitizeSegment = (segment?: string | null) => {
  const slug = safeSlug(segment)
  if (!slug) {
    return null
  }
  const scrubbed = slug.replace(/\./g, '')
  if (!scrubbed) {
    return null
  }
  return scrubbed
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter((item): item is string => Boolean(item))
}

export function resolveContentFilePath(
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect,
  options?: { organizationSlug?: string | null }
) {
  const frontmatterSlug = typeof version.frontmatter?.slug === 'string' ? version.frontmatter.slug : ''
  const contentSlug = typeof content.slug === 'string' ? content.slug : ''
  const fallbackSlug = content.id || 'draft'

  const resolvedSlug =
    sanitizeSegment(frontmatterSlug)
    || sanitizeSegment(contentSlug)
    || sanitizeSegment(fallbackSlug)
    || 'draft'

  const segments = ['content']
  const orgSegment = sanitizeSegment(options?.organizationSlug)
  if (orgSegment) {
    segments.push(orgSegment)
  }
  segments.push(resolvedSlug)

  return `${segments.join('/')}.mdx`
}

function resolveSourceLink(
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  assets: typeof schema.contentVersion.$inferSelect['assets']
) {
  const metadata = sourceContent?.metadata as Record<string, any> | undefined
  if (metadata?.originalUrl) {
    return metadata.originalUrl
  }
  if (sourceContent?.sourceType === 'youtube' && sourceContent.externalId) {
    return `https://www.youtube.com/watch?v=${sourceContent.externalId}`
  }
  const assetSource = assets && typeof assets === 'object' ? (assets as any).source : null
  if (assetSource?.originalUrl) {
    return assetSource.originalUrl
  }
  return null
}

export function buildWorkspaceFilesPayload(
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect,
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  options?: { organizationSlug?: string | null }
): WorkspaceFilePayload[] {
  const body = version.bodyMdx || version.bodyHtml || ''
  const sections = Array.isArray(version.sections) ? version.sections as ContentSection[] : []
  const frontmatter = version.frontmatter && typeof version.frontmatter === 'object'
    ? version.frontmatter as Record<string, any>
    : {}
  const seoSnapshot = version.seoSnapshot && typeof version.seoSnapshot === 'object'
    ? version.seoSnapshot as Record<string, any>
    : null
  const seoPlan = seoSnapshot && typeof seoSnapshot.plan === 'object' ? seoSnapshot.plan : null
  const generatorDetails = version.assets && typeof version.assets === 'object' ? (version.assets as any).generator ?? null : null
  const generatorStages = Array.isArray(generatorDetails?.stages)
    ? generatorDetails.stages.filter((stage: any) => typeof stage === 'string').map((stage: string) => stage.trim()).filter(Boolean)
    : []
  const filename = resolveContentFilePath(content, version, { organizationSlug: options?.organizationSlug })
  const frontmatterKeywords = normalizeStringArray(frontmatter.keywords || frontmatter.tags || [])
  const tags = normalizeStringArray(frontmatter.tags)
  const schemaTypes = normalizeStringArray(frontmatter.schemaTypes)
  const seoKeywords = normalizeStringArray(seoPlan?.keywords)
  const wordCount = sections.reduce((total, section: any) => {
    const count = typeof section?.wordCount === 'number' ? section.wordCount : Number(section?.wordCount) || 0
    return total + count
  }, 0) || body.split(/\s+/).filter(Boolean).length

  const fullMdx = enrichMdxWithMetadata({
    markdown: body,
    frontmatter: frontmatter as any,
    seoSnapshot,
    baseUrl: undefined,
    sections: sections as any
  })

  return [
    {
      id: version.id || filename,
      filename,
      body,
      frontmatter,
      wordCount,
      sectionsCount: sections.length,
      seoSnapshot,
      seoPlan,
      frontmatterKeywords,
      seoKeywords,
      tags,
      schemaTypes,
      generatorDetails,
      generatorStages,
      sourceDetails: sourceContent,
      sourceLink: resolveSourceLink(sourceContent, version.assets),
      fullMdx
    }
  ]
}
