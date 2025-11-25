import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'
import { composeBlogFromText } from '~~/server/utils/aiGateway'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, isContentSlugConstraintError } from '~~/server/utils/content'

interface GenerateContentOverrides {
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
}

export interface GenerateContentInput {
  organizationId: string
  userId: string
  text?: string | null
  sourceContentId?: string | null
  contentId?: string | null
  overrides?: GenerateContentOverrides
  systemPrompt?: string
  temperature?: number
}

export interface GenerateContentResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  meta: Record<string, any>
}

export const generateContentDraft = async (
  db: NodePgDatabase<typeof schema>,
  input: GenerateContentInput
): Promise<GenerateContentResult> => {
  const {
    organizationId,
    userId,
    text,
    sourceContentId,
    contentId,
    overrides,
    systemPrompt,
    temperature
  } = input

  if (!organizationId || !userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization and user context are required'
    })
  }

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null

  if (sourceContentId) {
    const [row] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, sourceContentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Source content not found for this organization'
      })
    }

    sourceContent = row
  }

  let existingContent: typeof schema.content.$inferSelect | null = null

  if (contentId) {
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, contentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found for this organization'
      })
    }

    existingContent = row
  }

  const explicitText = typeof text === 'string' && text.trim().length > 0 ? text.trim() : null
  const sourceText = typeof sourceContent?.sourceText === 'string' && sourceContent.sourceText.trim().length > 0
    ? sourceContent.sourceText.trim()
    : null

  const inputText = explicitText || sourceText

  if (!inputText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'text or sourceContentId with source_text is required'
    })
  }

  // Extract title from markdown if not provided
  // We'll parse it after generation
  let resolvedTitle = typeof overrides?.title === 'string' && overrides.title.trim().length > 0
    ? overrides.title
    : (existingContent?.title ?? sourceContent?.title ?? null)

  const selectedContentType = overrides?.contentType && CONTENT_TYPES.includes(overrides.contentType)
    ? overrides.contentType
    : (existingContent?.contentType ?? 'blog_post')

  const selectedStatus = overrides?.status && CONTENT_STATUSES.includes(overrides.status)
    ? overrides.status
    : (existingContent?.status ?? 'draft')

  const primaryKeyword = typeof overrides?.primaryKeyword === 'string'
    ? overrides.primaryKeyword
    : (existingContent?.primaryKeyword ?? null)

  const targetLocale = typeof overrides?.targetLocale === 'string'
    ? overrides.targetLocale
    : (existingContent?.targetLocale ?? null)

  const resolvedSourceContentId = sourceContent?.id ?? existingContent?.sourceContentId ?? null

  let markdown: string
  let meta: Record<string, any>

  try {
    const response = await composeBlogFromText(inputText, {
      systemPrompt,
      temperature
    })
    markdown = response.markdown
    meta = response.meta
    
    // Extract title from markdown if not already resolved
    // Look for first H1 (# Title) or use first line as fallback
    if (!resolvedTitle) {
      const h1Match = markdown.match(/^#\s+(.+)$/m)
      if (h1Match && h1Match[1]) {
        resolvedTitle = h1Match[1].trim()
      } else {
        // Use first non-empty line as title
        const firstLine = markdown.split('\n').find(line => line.trim().length > 0)
        resolvedTitle = firstLine ? firstLine.replace(/^#+\s*/, '').trim().slice(0, 100) : 'New Codex Draft'
      }
    }
  } catch (error: any) {
    console.error('Failed to generate content via AI Gateway', {
      error: error?.message || error,
      systemPromptPreview: systemPrompt?.slice(0, 200),
      temperature,
      inputPreview: inputText.slice(0, 200)
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'Content generation failed',
      data: {
        message: error?.message || 'Unknown AI generation error'
      }
    })
  }

  const assets = {
    generator: {
      engine: meta.engine,
      model: meta.model,
      generatedAt: new Date().toISOString()
    },
    source: sourceContent
      ? {
          id: sourceContent.id,
          type: sourceContent.sourceType,
          externalId: sourceContent.externalId
        }
      : null
  }

  const seoSnapshot = {
    meta,
    primaryKeyword,
    targetLocale,
    contentType: selectedContentType
  }

  // Parse sections from markdown
  const parseSectionsFromMarkdown = (mdx: string): Array<{
    id: string
    index: number
    type: string
    level?: number
    title: string
    startOffset: number
    endOffset: number
    anchor: string
    wordCount: number
    meta?: Record<string, any>
  }> => {
    const sections: Array<{
      id: string
      index: number
      type: string
      level?: number
      title: string
      startOffset: number
      endOffset: number
      anchor: string
      wordCount: number
      meta?: Record<string, any>
    }> = []
    
    // Match headings: # Title, ## Title, ### Title, etc.
    const headingRegex = /^(#{1,6})\s+(.+)$/gm
    const matches: Array<{ level: number; title: string; index: number }> = []
    let match
    
    // Collect all heading matches first
    while ((match = headingRegex.exec(mdx)) !== null) {
      matches.push({
        level: match[1].length,
        title: match[2].trim(),
        index: match.index
      })
    }
    
    // Process each heading to create sections
    matches.forEach((heading, idx) => {
      const startOffset = heading.index
      const endOffset = idx < matches.length - 1 ? matches[idx + 1].index : mdx.length
      
      // Extract section content
      const sectionContent = mdx.slice(startOffset, endOffset).trim()
      const wordCount = sectionContent.split(/\s+/).filter(w => w.length > 0).length
      
      // Generate anchor from title
      const anchor = heading.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      
      sections.push({
        id: `sec_${idx}`,
        index: idx,
        type: heading.level === 1 ? 'h1_block' : heading.level === 2 ? 'heading_block' : 'subheading_block',
        level: heading.level,
        title: heading.title,
        startOffset,
        endOffset,
        anchor,
        wordCount,
        meta: {
          isKeySection: heading.level <= 2
        }
      })
    })
    
    return sections
  }

  const parsedSections = parseSectionsFromMarkdown(markdown)

  const result = await db.transaction(async (tx) => {
    let contentRecord = existingContent
    let slug = existingContent?.slug

    if (!contentRecord) {
      const baseSlugInput = overrides?.slug || resolvedTitle || 'new-draft'
      let slugCandidate = await ensureUniqueContentSlug(tx, organizationId, baseSlugInput)
      let createdContent: typeof schema.content.$inferSelect | null = null
      let attempt = 0
      const maxAttempts = 5

      while (!createdContent && attempt < maxAttempts) {
        try {
          const [inserted] = await tx
            .insert(schema.content)
            .values({
              id: uuidv7(),
              organizationId,
              createdByUserId: userId,
              sourceContentId: resolvedSourceContentId,
              title: resolvedTitle || 'New Codex Draft',
              slug: slugCandidate,
              status: selectedStatus,
              primaryKeyword,
              targetLocale,
              contentType: selectedContentType,
              currentVersionId: null
            })
            .returning()

          createdContent = inserted
        } catch (error: any) {
          if (isContentSlugConstraintError(error)) {
            attempt += 1
            slugCandidate = await ensureUniqueContentSlug(
              tx,
              organizationId,
              `${baseSlugInput}-${Math.random().toString(36).slice(2, 6)}`
            )
            continue
          }
          throw error
        }
      }

      if (!createdContent) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Unable to allocate a unique slug for this content'
        })
      }

      slug = createdContent.slug
      contentRecord = createdContent
    } else {
      slug = contentRecord.slug

      const shouldUpdateSource = resolvedSourceContentId !== contentRecord.sourceContentId
      const shouldUpdate =
        resolvedTitle !== contentRecord.title ||
        selectedStatus !== contentRecord.status ||
        primaryKeyword !== contentRecord.primaryKeyword ||
        targetLocale !== contentRecord.targetLocale ||
        shouldUpdateSource ||
        selectedContentType !== contentRecord.contentType

      if (shouldUpdate) {
        const [updatedContent] = await tx
          .update(schema.content)
          .set({
            title: resolvedTitle,
            status: selectedStatus,
            primaryKeyword,
            targetLocale,
            sourceContentId: resolvedSourceContentId,
            contentType: selectedContentType,
            updatedAt: new Date()
          })
          .where(eq(schema.content.id, contentRecord.id))
          .returning()

        contentRecord = updatedContent
      }
    }

    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, contentRecord.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1
    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: contentRecord.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: resolvedTitle || 'New Codex Draft',
          slug,
          status: selectedStatus,
          contentType: selectedContentType,
          sourceContentId: resolvedSourceContentId
        },
        bodyMdx: markdown,
        bodyHtml: null,
        sections: parsedSections.length > 0 ? parsedSections : null,
        assets,
        seoSnapshot
      })
      .returning()

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.id))
      .returning()

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown,
    meta
  }
}
