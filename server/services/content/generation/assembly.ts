import type { ContentFrontmatter, ContentSection } from './types'
import { formatFrontmatterAsYaml } from './frontmatter'
import { generateStructuredDataJsonLd } from './structured-data'

/**
 * Extracts raw markdown from enriched MDX by stripping frontmatter and JSON-LD
 */
export const extractMarkdownFromEnrichedMdx = (enrichedMdx: string): string => {
  const trimmed = enrichedMdx.trim()

  // If it doesn't start with '---', it's not enriched, return as-is
  if (!trimmed.startsWith('---')) {
    return trimmed
  }

  // Find the end of frontmatter block (second '---' at start of line)
  // Use regex to match delimiter only when it appears alone at the start of a line
  // This avoids misidentifying occurrences inside multi-line YAML strings
  const frontmatterDelimiterRegex = /^---\s*$/m
  const match = trimmed.slice(3).match(frontmatterDelimiterRegex)
  if (!match) {
    // No closing frontmatter, return as-is
    return trimmed
  }
  // match.index is relative to trimmed.slice(3), so add 3 to get position in trimmed
  // match[0] includes the full delimiter line (--- plus optional whitespace)
  const delimiterLineStart = match.index! + 3
  const delimiterLineEnd = delimiterLineStart + match[0].length

  // Extract content after frontmatter
  // Content starts after the delimiter line (which ends with a newline)
  let contentStart = delimiterLineEnd
  // Skip optional Windows line endings or trailing newline
  if (trimmed[contentStart] === '\r') {
    contentStart += 1
  }
  if (trimmed[contentStart] === '\n') {
    contentStart += 1
  }
  let content = trimmed.substring(contentStart).trim()

  // Check if there's a JSON-LD script tag and remove it
  const jsonLdStart = content.indexOf('<script type="application/ld+json">')
  if (jsonLdStart !== -1) {
    const jsonLdEnd = content.indexOf('</script>', jsonLdStart)
    if (jsonLdEnd !== -1) {
      // Remove JSON-LD block and any surrounding whitespace
      const before = content.substring(0, jsonLdStart).trim()
      const after = content.substring(jsonLdEnd + 9).trim()
      content = [before, after].filter(Boolean).join('\n\n')
    }
  }

  return content.trim()
}

/**
 * Enriches markdown with frontmatter and JSON-LD structured data
 */
export const enrichMarkdownWithMetadata = (params: {
  markdown: string
  frontmatter: ContentFrontmatter
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
}): string => {
  const { markdown, frontmatter, seoSnapshot, baseUrl } = params

  // Extract raw markdown if already enriched
  const rawMarkdown = extractMarkdownFromEnrichedMdx(markdown)

  const frontmatterBlock = formatFrontmatterAsYaml(frontmatter)
  const jsonLd = generateStructuredDataJsonLd({ frontmatter, seoSnapshot, baseUrl })

  const parts: string[] = [frontmatterBlock]
  if (jsonLd) {
    parts.push(jsonLd)
  }
  parts.push(rawMarkdown)

  return parts.filter(part => part.trim().length > 0).join('\n\n')
}

export const assembleMarkdownFromSections = (params: {
  frontmatter: ContentFrontmatter
  sections: ContentSection[]
}) => {
  const ordered = [...params.sections].sort((a, b) => a.index - b.index)
  let markdown = `# ${params.frontmatter.title}\n\n`
  let currentOffset = markdown.length

  const sectionsWithOffsets = ordered.map((section) => {
    const level = Math.min(Math.max(section.level || 2, 2), 6)
    const headingLine = section.title ? `${'#'.repeat(level)} ${section.title}` : ''
    const pieces = [headingLine, section.body.trim()].filter(Boolean)
    const block = pieces.join('\n\n')
    const blockWithPadding = `${block}\n\n`
    const startOffset = currentOffset
    markdown += blockWithPadding
    currentOffset = markdown.length

    return {
      ...section,
      startOffset,
      endOffset: startOffset + blockWithPadding.length,
      body_mdx: section.body
    }
  })

  markdown = `${markdown.trim()}\n`

  return {
    markdown,
    sections: sectionsWithOffsets
  }
}
