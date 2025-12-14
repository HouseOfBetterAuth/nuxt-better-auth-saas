import { safeWarn } from '~~/server/utils/safeLogger'

/**
 * Calculates diff statistics between two text bodies using a simple unique-line comparison.
 * Falls back to line-count estimation when structural changes are unclear.
 */
export function calculateDiffStats(oldText: string, newText: string): { additions: number, deletions: number } {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const oldNonEmpty = oldLines.filter(line => line.trim().length > 0)
  const newNonEmpty = newLines.filter(line => line.trim().length > 0)

  const oldUnique = new Map<string, number>()
  const newUnique = new Map<string, number>()

  for (const line of oldNonEmpty) {
    const trimmed = line.trim()
    oldUnique.set(trimmed, (oldUnique.get(trimmed) || 0) + 1)
  }

  for (const line of newNonEmpty) {
    const trimmed = line.trim()
    newUnique.set(trimmed, (newUnique.get(trimmed) || 0) + 1)
  }

  let additions = 0
  let deletions = 0

  for (const [line, newCount] of newUnique.entries()) {
    const oldCount = oldUnique.get(line) || 0
    if (newCount > oldCount) {
      additions += newCount - oldCount
    }
  }

  for (const [line, oldCount] of oldUnique.entries()) {
    const newCount = newUnique.get(line) || 0
    if (oldCount > newCount) {
      deletions += oldCount - newCount
    }
  }

  if (oldText === newText) {
    return { additions: 0, deletions: 0 }
  }

  if (additions === 0 && deletions === 0) {
    const lineDiff = newNonEmpty.length - oldNonEmpty.length
    if (lineDiff > 0) {
      additions = lineDiff
    } else if (lineDiff < 0) {
      deletions = Math.abs(lineDiff)
    } else {
      // Whitespace-only edits or reordered lines that retain the same trimmed content
      // shouldn't be counted as substantive additions/deletions.
      return { additions: 0, deletions: 0 }
    }
  }

  return { additions, deletions }
}

const clampOffset = (offset: number, length: number): number => {
  if (!Number.isFinite(offset)) {
    safeWarn('[diff] Received invalid offset value', { offset })
    return 0
  }

  if (offset < 0) {
    safeWarn('[diff] Received negative offset value, clamping to 0', { offset })
  }

  if (offset > length) {
    safeWarn('[diff] Offset exceeds text length, clamping to end', { offset, length })
  }

  const clamped = Math.min(Math.max(0, Math.floor(offset)), length)
  return clamped
}

/**
 * Converts a character offset into a 1-indexed line number.
 */
export function offsetToLineNumber(text: string, offset: number): number {
  if (!text) {
    return 1
  }

  const clamped = clampOffset(offset, text.length)
  if (clamped === 0) {
    return 1
  }

  const segment = text.slice(0, clamped)
  const newlineCount = segment.match(/\n/g)?.length ?? 0
  return newlineCount + 1
}

/**
 * Calculates a line range from character offsets.
 */
export function calculateLineRange(
  text: string,
  startOffset: number,
  endOffset: number
): { start: number, end: number } {
  const clampedStart = clampOffset(startOffset, text.length)
  const clampedEnd = clampOffset(endOffset, text.length)
  const normalizedStart = Math.min(clampedStart, clampedEnd)
  const normalizedEnd = Math.max(clampedStart, clampedEnd)

  return {
    start: offsetToLineNumber(text, normalizedStart),
    end: offsetToLineNumber(text, normalizedEnd)
  }
}

/**
 * Finds the line range for a specific content section within assembled markdown.
 */
export function findSectionLineRange(
  markdown: string,
  sectionId: string,
  sections: Array<{ id: string, startOffset?: number, endOffset?: number }>
): { start: number, end: number } | null {
  if (!sections?.length) {
    safeWarn('[diff] No sections supplied when looking up line range', { sectionId })
    return null
  }

  const section = sections.find(({ id }) => id === sectionId)
  if (!section) {
    safeWarn('[diff] Could not find section when computing line range', { sectionId })
    return null
  }

  const { startOffset, endOffset } = section
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
    safeWarn('[diff] Section is missing offsets for line range calculation', {
      sectionId,
      hasStartOffset: Number.isFinite(startOffset),
      hasEndOffset: Number.isFinite(endOffset)
    })
    return null
  }

  return calculateLineRange(markdown, startOffset as number, endOffset as number)
}

/**
 * Generate a deeplink URL to content with line range highlighting.
 */
export function generateContentDeeplink(
  contentId: string,
  lineRange: { start: number, end: number },
  options?: { orgSlug?: string | null }
): string {
  const basePath = options?.orgSlug
    ? `/${options.orgSlug}/content/${contentId}`
    : `/content/${contentId}`
  return `${basePath}?lines=${lineRange.start}-${lineRange.end}`
}
