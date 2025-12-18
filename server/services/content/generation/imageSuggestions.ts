import type { ContentFrontmatter, ContentSection, ImageSuggestion } from './types'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { safeWarn } from '~~/server/utils/safeLogger'
import { parseAIResponseAsJSON } from './utils'

const DEFAULT_MAX_SUGGESTIONS = 8

const normalizePriority = (value?: string | null): ImageSuggestion['priority'] => {
  const normalized = (value ?? '').toLowerCase().trim()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  return 'medium'
}

const clampPosition = (value: unknown, maxLine: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1
  }
  return Math.min(Math.floor(parsed), maxLine)
}

const buildLineIndex = (markdown: string) => {
  const lines = markdown.split('\n')
  let offset = 0
  return lines.map((line, idx) => {
    const start = offset
    offset += line.length + 1 // +1 for the newline character that was split away
    return {
      line: idx + 1,
      start,
      end: offset
    }
  })
}

const findLineNumberForOffset = (offset: number | undefined, index: ReturnType<typeof buildLineIndex>) => {
  if (typeof offset !== 'number' || Number.isNaN(offset) || offset < 0) {
    return null
  }

  for (const entry of index) {
    if (offset < entry.end) {
      return entry.line
    }
  }

  return index.length || null
}

interface VttCue {
  start: number
  end: number
  text: string
}

const parseVttTimestamp = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.').replace(/\s+/g, '')
  const parts = normalized.split(':')

  if (parts.length < 2 || parts.length > 3) {
    return null
  }

  const [hours, minutes, seconds] = parts.length === 3
    ? parts
    : ['0', parts[0], parts[1]]

  const h = Number(hours)
  const m = Number(minutes)
  const s = Number(seconds)

  if ([h, m, s].some(entry => Number.isNaN(entry))) {
    return null
  }

  return h * 3600 + m * 60 + s
}

const parseVttToTimestamps = (vttContent: string): VttCue[] => {
  if (!vttContent || !vttContent.trim()) {
    return []
  }

  const lines = vttContent.split(/\r?\n/)
  const cues: VttCue[] = []
  let current: VttCue | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      if (current) {
        cues.push(current)
        current = null
      }
      continue
    }

    const timestampMatch = line.match(/(?<start>[0-9:,.]+)\s+-->\s+(?<end>[0-9:,.]+)/)

    if (timestampMatch?.groups) {
      const start = parseVttTimestamp(timestampMatch.groups.start)
      const end = parseVttTimestamp(timestampMatch.groups.end)

      if (start !== null && end !== null) {
        current = { start, end, text: '' }
      }
      continue
    }

    if (current) {
      current.text = current.text ? `${current.text}\n${line}` : line
    }
  }

  if (current) {
    cues.push(current)
  }

  return cues
}

const estimateTimestampForSuggestion = (
  suggestion: ImageSuggestion,
  cues: VttCue[],
  totalLines: number
): number | null => {
  if (!cues.length || totalLines <= 0) {
    return null
  }

  const duration = cues.reduce((max, cue) => Math.max(max, cue.end), 0)
  if (!duration || !Number.isFinite(duration)) {
    return null
  }

  const ratio = Math.min(1, Math.max(0, (suggestion.position - 1) / totalLines))
  const estimated = duration * ratio
  const cue = cues.find(entry => estimated >= entry.start && estimated <= entry.end)
  const timestamp = cue?.start ?? estimated

  return Number.isFinite(timestamp) ? Number(timestamp.toFixed(3)) : null
}

export const suggestImagesForContent = async (params: {
  markdown: string
  sections: Array<ContentSection & { startOffset?: number, endOffset?: number }> | null
  frontmatter?: Pick<ContentFrontmatter, 'title' | 'contentType' | 'primaryKeyword' | 'targetLocale'> | null
  sourceContent?: { sourceType: string, externalId?: string | null, metadata?: any } | null
  maxSuggestions?: number
}): Promise<ImageSuggestion[]> => {
  const { markdown, sections, frontmatter, sourceContent, maxSuggestions = DEFAULT_MAX_SUGGESTIONS } = params

  if (!markdown || !markdown.trim()) {
    return []
  }

  const lines = markdown.split('\n')
  const lineIndex = buildLineIndex(markdown)
  const maxLine = lines.length

  const sectionsWithLines = Array.isArray(sections)
    ? sections.map((section) => {
        const startLine = findLineNumberForOffset(section.startOffset, lineIndex)
        const endLine = findLineNumberForOffset(section.endOffset, lineIndex)
        return {
          id: section.id,
          title: section.title,
          index: section.index,
          startLine,
          endLine
        }
      })
    : []

  const numberedMarkdownPreview = lines
    .map((line, idx) => `${idx + 1}: ${line}`)
    .join('\n')

  const sectionsSummary = sectionsWithLines.length
    ? [
        'Sections (with line ranges when available):',
        sectionsWithLines
          .map(section => `- ${section.title || 'Untitled'} (id: ${section.id}, index: ${section.index}${section.startLine ? `, lines ${section.startLine}-${section.endLine ?? '?'}` : ''})`)
          .join('\n')
      ].join('\n')
    : 'No section metadata available.'

  const prompt = [
    'You are a visual editor identifying where images will most improve comprehension and engagement.',
    frontmatter?.title ? `Content title: ${frontmatter.title}` : null,
    frontmatter?.contentType ? `Content type: ${frontmatter.contentType}` : null,
    frontmatter?.primaryKeyword ? `Primary keyword: ${frontmatter.primaryKeyword}` : null,
    frontmatter?.targetLocale ? `Target locale: ${frontmatter.targetLocale}` : null,
    sectionsSummary,
    'Markdown with line numbers (use these for positioning):',
    numberedMarkdownPreview,
    `Return JSON only with shape: { "suggestions": [{ "sectionId": string, "position": number, "altText": string, "reason": string, "priority": "high" | "medium" | "low" }] }. Limit to ${maxSuggestions} suggestions.`,
    'Guidelines: recommend images that clarify complex ideas, provide visual examples, or break up long sections. Keep alt text specific, descriptive, and SEO-friendly. Tie each suggestion to the most relevant sectionId. Choose the line number at the start of the paragraph where the image should appear. Avoid generic or decorative images.'
  ]
    .filter(Boolean)
    .join('\n\n')

  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: 'You return JSON only. No prose explanations.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  })

  const parsed = parseAIResponseAsJSON<{ suggestions?: Array<Partial<ImageSuggestion>> }>(raw, 'image suggestions')

  const validSectionIds = new Set(sectionsWithLines.map(section => section.id).filter(Boolean))

  const sanitized: ImageSuggestion[] = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .filter(item => item && typeof item === 'object')
        .slice(0, maxSuggestions)
        .map((item) => {
          const position = clampPosition(item.position, maxLine)
          const sectionId = (item.sectionId ?? '').toString().trim()
          const altText = (item.altText ?? '').toString().trim()
          const reason = (item.reason ?? '').toString().trim()
          const priority = normalizePriority((item as any).priority)

          return {
            sectionId,
            position,
            altText,
            reason,
            priority,
            type: 'generated'
          }
        })
        .filter(item => item.sectionId && item.altText && item.reason)
        .map((item) => {
          if (validSectionIds.size > 0 && !validSectionIds.has(item.sectionId)) {
            return { ...item, sectionId: sectionsWithLines[0]?.id || item.sectionId }
          }
          return item
        })
    : []

  if (sanitized.length === 0 && parsed?.suggestions) {
    safeWarn('[suggestImagesForContent] Parsed suggestions were empty after sanitization', {
      suggestionsCount: parsed.suggestions?.length || 0
    })
  }

  const isYoutube = sourceContent?.sourceType === 'youtube' && Boolean(sourceContent.externalId)

  if (!isYoutube) {
    return sanitized
  }

  const videoId = sourceContent.externalId as string
  const vttContent = sourceContent.metadata?.youtube?.vttContent
  const cues = vttContent ? parseVttToTimestamps(vttContent) : []
  const totalLines = lines.length || 1

  return sanitized.map((suggestion) => {
    const estimatedTimestamp = cues.length
      ? estimateTimestampForSuggestion(suggestion, cues, totalLines)
      : null

    return {
      ...suggestion,
      type: 'screencap',
      videoId,
      estimatedTimestamp,
      status: 'pending'
    }
  })
}
