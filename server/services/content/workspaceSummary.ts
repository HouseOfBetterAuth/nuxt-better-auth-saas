import type * as schema from '~~/server/database/schema'

interface WorkspaceSummaryInput {
  content: typeof schema.content.$inferSelect
  currentVersion?: typeof schema.contentVersion.$inferSelect | null
  sourceContent?: typeof schema.sourceContent.$inferSelect | null
}

interface SourceSummaryInput {
  sourceContent: typeof schema.sourceContent.$inferSelect | null
}

export interface SourceSummaryPreview {
  title: string | null
  typeLabel: string
  url: string | null
  thumbnailUrl: string | null
  authorName: string | null
  providerName: string | null
  embedUrl: string | null
}

interface SectionLike {
  title?: string | null
  summary?: string | null
  type?: string | null
}

function toSentenceList(values: string[]) {
  if (!values.length) {
    return ''
  }
  if (values.length === 1) {
    return values[0]
  }
  const last = values[values.length - 1]
  return `${values.slice(0, -1).join(', ')} and ${last}`
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(entry => normalizeString(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  const asString = normalizeString(value)
  if (asString) {
    return asString
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
  }
  return []
}

function finalizeSummary(summaryParts: string[]): string | null {
  const summary = summaryParts.join('\n\n').trim()
  return summary.length ? summary : null
}

function deriveSourcePresentation(source: typeof schema.sourceContent.$inferSelect | null) {
  if (!source) {
    return null
  }
  const metadata = source.metadata as Record<string, any> | undefined
  const youtubeMetadata = metadata?.youtube as Record<string, any> | undefined
  const previewMetadata = youtubeMetadata?.preview as Record<string, any> | undefined
  const baseTitle = normalizeString(source.title)
    || normalizeString(metadata?.title)
    || normalizeString(metadata?.name)
    || normalizeString(youtubeMetadata?.workerMetadata?.title)
    || null
  const sourceTypeRaw = normalizeString(source.sourceType) || 'source'
  const sourceTypeLabel = (() => {
    switch (sourceTypeRaw) {
      case 'youtube':
        return 'YouTube video'
      case 'google_doc':
        return 'Google Doc'
      default:
        return sourceTypeRaw.replace(/_/g, ' ')
    }
  })()
  const sourceUrl = normalizeString(metadata?.originalUrl)
  const thumbnail = normalizeString(previewMetadata?.thumbnailUrl)
    || normalizeString(youtubeMetadata?.workerMetadata?.thumbnail_url)
    || null
  const providerName = normalizeString(previewMetadata?.providerName)
    || normalizeString(youtubeMetadata?.workerMetadata?.provider_name)
    || null
  const authorName = normalizeString(previewMetadata?.authorName)
    || normalizeString(youtubeMetadata?.workerMetadata?.author_name)
    || null
  const videoId = source.sourceType === 'youtube'
    ? source.externalId || youtubeMetadata?.workerMetadata?.video_id || youtubeMetadata?.workerMetadata?.videoId
    : null
  const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : null

  return {
    title: baseTitle,
    typeLabel: sourceTypeLabel,
    url: sourceUrl,
    thumbnailUrl: thumbnail,
    providerName,
    authorName,
    embedUrl
  }
}

export function buildSourceSummaryPreview(payload: SourceSummaryInput): SourceSummaryPreview | null {
  const presentation = deriveSourcePresentation(payload.sourceContent)
  if (!presentation) {
    return null
  }
  return presentation
}

function extractSections(version?: typeof schema.contentVersion.$inferSelect | null) {
  const rawSections = version?.sections
  if (!Array.isArray(rawSections)) {
    return []
  }
  return rawSections
    .map((section, index): SectionLike => {
      if (section && typeof section === 'object') {
        return {
          title: 'title' in section && section.title ? String(section.title) : `Section ${index + 1}`,
          summary: 'summary' in section && typeof section.summary === 'string' ? section.summary : null,
          type: 'type' in section && typeof section.type === 'string' ? section.type : null
        }
      }
      return {
        title: `Section ${index + 1}`,
        summary: null,
        type: null
      }
    })
}

interface AssetsWithSource {
  source?: {
    type?: string | null
    originalUrl?: string | null
  }
}

export function buildWorkspaceSummary(payload: WorkspaceSummaryInput) {
  const summaryParts: string[] = []
  const frontmatter = payload.currentVersion?.frontmatter as Record<string, any> | undefined
  const description = normalizeString(frontmatter?.description)

  const contentType =
    normalizeString(frontmatter?.contentType)
    || normalizeString(payload.content.contentType)
    || 'content'

  const status = normalizeString(payload.content.status)
  const sections = extractSections(payload.currentVersion)
  const keywords = normalizeStringList(frontmatter?.keywords || frontmatter?.tags)
  const seoSnapshot = payload.currentVersion?.seoSnapshot as Record<string, any> | undefined
  const seoPlan = seoSnapshot && typeof seoSnapshot === 'object' ? seoSnapshot.plan : null
  const seoKeywords = normalizeStringList(seoPlan?.keywords)

  if (description) {
    summaryParts.push(description)
  } else {
    const baseTitle =
      normalizeString(frontmatter?.seoTitle)
      || normalizeString(frontmatter?.title)
      || normalizeString(payload.content.title)
      || 'This piece'

    summaryParts.push(`${baseTitle} is a ${contentType} draft ${status ? `currently ${status}` : 'in progress'}.`)
  }

  if (sections.length) {
    const uniqueTypes = Array.from(
      new Set(
        sections
          .map(section => normalizeString(section.type))
          .filter((type): type is string => Boolean(type))
      )
    )
    const sectionTitles = sections
      .map(section => normalizeString(section.title))
      .filter((title): title is string => Boolean(title))
      .slice(0, 3)

    const sentence: string[] = [
      `It contains ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}`
    ]

    if (sectionTitles.length) {
      sentence.push(`covering ${toSentenceList(sectionTitles)}.`)
    } else {
      sentence.push('.')
    }

    if (uniqueTypes.length) {
      sentence.push(`Key parts include ${toSentenceList(uniqueTypes)} segments.`)
    }

    summaryParts.push(sentence.join(' '))
  }

  const combinedKeywords = Array.from(new Set([...keywords, ...seoKeywords])).slice(0, 5)
  if (combinedKeywords.length) {
    summaryParts.push(`Primary topics include ${toSentenceList(combinedKeywords)}.`)
  }

  const sourceMetadata = payload.sourceContent?.metadata as Record<string, any> | undefined
  const assets = payload.currentVersion?.assets as AssetsWithSource | undefined
  const sourceType =
    normalizeString(payload.sourceContent?.sourceType)
    || normalizeString(assets?.source?.type)
  const sourceUrl =
    normalizeString(assets?.source?.originalUrl)
    || normalizeString(sourceMetadata?.originalUrl)

  if (sourceType) {
    const sourceDetails = normalizeString(sourceMetadata?.title)
      || normalizeString(sourceMetadata?.name)
      || normalizeString(sourceMetadata?.originalUrl)
      || normalizeString(payload.sourceContent?.externalId)
    const linkHint = sourceUrl ? ` (${sourceUrl})` : ''
    summaryParts.push(`The draft was generated from ${sourceType}${sourceDetails ? ` "${sourceDetails}"` : ''}${linkHint}.`)
  }

  const updatedAt = payload.currentVersion?.createdAt || payload.content.updatedAt
  if (updatedAt) {
    const asDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
    if (!Number.isNaN(asDate.getTime())) {
      summaryParts.push(`Last updated ${asDate.toLocaleDateString()} ${asDate.toLocaleTimeString()}.`)
    }
  }

  return finalizeSummary(summaryParts)
}
