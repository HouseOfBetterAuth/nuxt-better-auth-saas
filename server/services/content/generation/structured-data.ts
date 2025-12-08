import type { ContentFrontmatter } from './types'

export const generateStructuredDataJsonLd = (params: {
  frontmatter: ContentFrontmatter
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
}): string => {
  const { frontmatter, seoSnapshot, baseUrl } = params
  const schemaTypes = Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes : []
  const normalizedSchemaTypes = schemaTypes
    .map(type => (typeof type === 'string' ? type.trim() : ''))
    .filter((type): type is string => Boolean(type))

  if (!normalizedSchemaTypes.length) {
    return ''
  }

  const structuredData: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': normalizedSchemaTypes[0] || 'BlogPosting'
  }

  // Basic article properties
  if (frontmatter.title) {
    structuredData.headline = frontmatter.title
  }
  if (frontmatter.description) {
    structuredData.description = frontmatter.description
  }
  if (frontmatter.primaryKeyword) {
    structuredData.keywords = frontmatter.primaryKeyword
  }
  if (Array.isArray(frontmatter.keywords) && frontmatter.keywords.length > 0) {
    const keywordEntries = frontmatter.keywords
      .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
      .filter((keyword): keyword is string => Boolean(keyword))
    const normalizedPrimary = typeof frontmatter.primaryKeyword === 'string'
      ? frontmatter.primaryKeyword.trim()
      : ''
    const hasPrimary = normalizedPrimary
      ? keywordEntries.includes(normalizedPrimary)
      : false
    const keywordsList = normalizedPrimary && !hasPrimary
      ? [normalizedPrimary, ...keywordEntries]
      : keywordEntries
    if (keywordsList.length) {
      structuredData.keywords = keywordsList.join(', ')
    }
  }

  // Add datePublished if available
  const seoPlan = seoSnapshot && typeof seoSnapshot === 'object' ? seoSnapshot.plan : null
  if (seoPlan && typeof seoPlan === 'object' && seoPlan.datePublished) {
    structuredData.datePublished = seoPlan.datePublished
  }

  // Add URL if baseUrl is provided
  if (baseUrl && frontmatter.slug) {
    const normalizedBase = baseUrl.replace(/\/+$/, '')
    const normalizedSlug = frontmatter.slug.replace(/^\/+/, '')
    structuredData.url = `${normalizedBase}/${normalizedSlug}`
  }

  // Add additional schema types as nested structures
  if (normalizedSchemaTypes.length > 1) {
    structuredData['@type'] = normalizedSchemaTypes
  }

  const jsonLd = JSON.stringify(structuredData, null, 2)
  return `<script type="application/ld+json">\n${jsonLd}\n</script>`
}
