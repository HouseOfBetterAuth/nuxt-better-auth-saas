import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type {
  ContentGenerationInput,
  ContentGenerationResult,
  SectionUpdateInput,
  SectionUpdateResult
} from './types'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/database/schema'

import { callChatCompletions } from '~~/server/utils/aiGateway'
// Conversation quota is checked at chat session creation, not here
// Content generation can happen as part of existing conversations
import {
  CONTENT_TYPES,
  ensureUniqueContentSlug,
  resolveIngestMethodFromSourceContent
} from '~~/server/utils/content'
import { validateEnum } from '~~/server/utils/validation'
import {
  assembleMarkdownFromSections,
  enrichMarkdownWithMetadata,
  extractMarkdownFromEnrichedMdx
} from './assembly'
import {
  ensureSourceContentChunksExist,
  findRelevantChunksForSection
} from './chunking'
import {
  createFrontmatterFromOutline,
  enrichFrontmatterWithMetadata,
  extractFrontmatterFromVersion
} from './frontmatter'
import { createGenerationMetadata, createSectionUpdateMetadata } from './metadata'
import { generateContentOutline } from './planning'
import {
  CONTENT_SECTION_UPDATE_SYSTEM_PROMPT,
  generateContentSectionsFromOutline,
  normalizeContentSections
} from './sections'
import {
  countWords,
  isValidContentFrontmatter,
  parseAIResponseAsJSON
} from './utils'

// Re-export types for backward compatibility
export type {
  ContentGenerationInput as GenerateContentInput,
  ContentGenerationResult as GenerateContentResult
}

// Internal constant alias
const SECTION_PATCH_SYSTEM_PROMPT = CONTENT_SECTION_UPDATE_SYSTEM_PROMPT

// Re-export for external use (used by workspaceFiles.ts)
export const enrichMdxWithMetadata = enrichMarkdownWithMetadata

/**
 * Generates a content draft from a source content (transcript, YouTube video, etc.)
 *
 * @param db - Database instance
 * @param input - Input parameters for content generation
 * @returns Generated content draft with markdown and metadata
 */
export const generateContentDraftFromSource = async (
  db: NodePgDatabase<typeof schema>,
  input: ContentGenerationInput
): Promise<ContentGenerationResult> => {
  const {
    organizationId,
    userId,
    sourceContentId,
    sourceText,
    contentId,
    overrides,
    systemPrompt,
    temperature,
    event: _event
  } = input

  if (!organizationId || !userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization and user context are required'
    })
  }

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null
  let resolvedSourceText: string | null = null
  let resolvedIngestMethod: string | null = null

  // If inline sourceText is provided, use it directly
  if (sourceText && sourceText.trim()) {
    resolvedSourceText = sourceText.trim()
    resolvedIngestMethod = 'inline_transcript'
  } else if (sourceContentId) {
    // Otherwise, fetch from source content
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
    resolvedSourceText = sourceContent.sourceText?.trim() || null
    resolvedIngestMethod = resolveIngestMethodFromSourceContent(sourceContent)

    // Log for debugging
    console.log('[generateContentDraftFromSource] Source content found:', {
      id: sourceContent.id,
      ingestStatus: sourceContent.ingestStatus,
      sourceTextLength: resolvedSourceText?.length || 0,
      hasSourceText: !!resolvedSourceText,
      sourceType: sourceContent.sourceType,
      externalId: sourceContent.externalId
    })
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

  if (!resolvedSourceText) {
    console.error('[generateContentDraftFromSource] Missing sourceText:', {
      sourceContentId,
      hasSourceContent: !!sourceContent,
      sourceTextLength: resolvedSourceText?.length || 0,
      sourceTextPreview: resolvedSourceText?.substring(0, 100) || 'null/empty',
      ingestStatus: sourceContent?.ingestStatus
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'A source transcript is required to create a draft. Provide either sourceContentId or sourceText.'
    })
  }

  // If we have sourceContent, use its chunks; otherwise create temporary chunks for inline text
  let chunks: Awaited<ReturnType<typeof ensureSourceContentChunksExist>> | null = null
  if (sourceContent) {
    chunks = await ensureSourceContentChunksExist(db, sourceContent, resolvedSourceText!)
  } else if (resolvedSourceText) {
    // For inline sourceText without sourceContent, we'll need to create chunks on the fly
    // For now, we'll skip chunking for inline text (the generation will work without chunks)
    // In the future, we could create temporary chunks here
    chunks = null
  }

  if (!contentId) {
    // Fetch user to check email verification status
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found'
      })
    }

    const [membership] = await db
      .select()
      .from(schema.member)
      .where(and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      ))
      .limit(1)

    if (!membership) {
      throw createError({
        statusCode: 403,
        statusMessage: 'User is not a member of this organization'
      })
    }

    // Conversation quota is checked at chat session creation, not here
    // Content generation can happen as part of existing conversations
  }

  // Track pipeline stages as they complete
  const pipelineStages: string[] = []

  // Chunking stage (if chunks were created/verified)
  if (chunks && chunks.length > 0) {
    pipelineStages.push('chunking')
  }

  let contentType: typeof CONTENT_TYPES[number]
  if (overrides?.contentType) {
    contentType = validateEnum(overrides.contentType, CONTENT_TYPES, 'contentType')
  } else if (existingContent?.contentType) {
    contentType = validateEnum(existingContent.contentType, CONTENT_TYPES, 'contentType')
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: `contentType is required and must be one of: ${CONTENT_TYPES.join(', ')}`
    })
  }

  const plan = await generateContentOutline({
    contentType,
    instructions: systemPrompt,
    chunks: chunks || [], // Ensure chunks is always an array
    sourceText: resolvedSourceText, // Pass inline sourceText if available
    sourceTitle: sourceContent?.title ?? existingContent?.title ?? null
  })
  pipelineStages.push('plan')

  let frontmatter = createFrontmatterFromOutline({
    plan,
    overrides,
    existingContent,
    sourceContent
  })
  frontmatter = enrichFrontmatterWithMetadata({
    plan,
    frontmatter,
    sourceContent
  })
  pipelineStages.push('frontmatter')

  if (input.onPlanReady) {
    await input.onPlanReady({ plan, frontmatter })
  }

  const sections = await generateContentSectionsFromOutline({
    outline: plan.outline,
    frontmatter,
    chunks: chunks || [],
    instructions: systemPrompt,
    temperature,
    organizationId,
    sourceContentId: frontmatter.sourceContentId ?? sourceContent?.id ?? null
  })
  pipelineStages.push('sections')

  const assembled = assembleMarkdownFromSections({
    frontmatter,
    sections
  })
  pipelineStages.push('assembly')

  const resolvedSourceContentId = frontmatter.sourceContentId ?? sourceContent?.id ?? null
  const selectedStatus = frontmatter.status
  const selectedContentType = frontmatter.contentType
  const primaryKeyword = frontmatter.primaryKeyword ?? null
  const targetLocale = frontmatter.targetLocale ?? null

  // SEO snapshot is created, so SEO stage is complete
  pipelineStages.push('seo')

  const assets = createGenerationMetadata(sourceContent, pipelineStages)
  const seoSnapshot = {
    plan: plan.seo,
    primaryKeyword,
    targetLocale,
    contentType: selectedContentType,
    schemaTypes: frontmatter.schemaTypes
  }

  // Enrich MDX with frontmatter and JSON-LD structured data
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: assembled.markdown,
    frontmatter,
    seoSnapshot
  })
  pipelineStages.push('enrichment')

  const result = await db.transaction(async (tx) => {
    let contentRecord = existingContent
    let slug = existingContent?.slug
    const baseSlugInput = overrides?.slug || frontmatter.slugSuggestion || frontmatter.title

    if (!contentRecord) {
      if (!baseSlugInput || !baseSlugInput.trim()) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Slug is required. Provide a slug, slugSuggestion, or title in the plan.'
        })
      }

      const slugCandidate = await ensureUniqueContentSlug(tx, organizationId, baseSlugInput)

      const [inserted] = await tx
        .insert(schema.content)
        .values({
          id: uuidv7(),
          organizationId,
          createdByUserId: userId,
          sourceContentId: resolvedSourceContentId,
          ingestMethod: resolvedIngestMethod,
          title: frontmatter.title,
          slug: slugCandidate,
          status: selectedStatus,
          primaryKeyword,
          targetLocale,
          contentType: selectedContentType,
          currentVersionId: null
        })
        .returning()

      if (!inserted) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to create content record'
        })
      }

      slug = inserted.slug
      contentRecord = inserted
    } else {
      slug = contentRecord.slug

      const shouldUpdateSource = resolvedSourceContentId !== contentRecord.sourceContentId
      const shouldUpdateIngestMethod = resolvedIngestMethod !== contentRecord.ingestMethod
      const shouldUpdate =
        frontmatter.title !== contentRecord.title ||
        selectedStatus !== contentRecord.status ||
        primaryKeyword !== contentRecord.primaryKeyword ||
        targetLocale !== contentRecord.targetLocale ||
        shouldUpdateSource ||
        shouldUpdateIngestMethod ||
        selectedContentType !== contentRecord.contentType

      if (shouldUpdate) {
        const [updatedContent] = await tx
          .update(schema.content)
          .set({
            title: frontmatter.title,
            status: selectedStatus,
            primaryKeyword,
            targetLocale,
            sourceContentId: resolvedSourceContentId,
            ingestMethod: resolvedIngestMethod ?? contentRecord.ingestMethod ?? null,
            contentType: selectedContentType,
            updatedAt: new Date()
          })
          .where(eq(schema.content.id, contentRecord.id))
          .returning()

        if (!updatedContent) {
          throw createError({
            statusCode: 500,
            statusMessage: 'Failed to update content record'
          })
        }

        contentRecord = updatedContent
      }
    }

    if (!contentRecord) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Content record was not resolved.'
      })
    }

    frontmatter = { ...frontmatter, slug: slug as string }

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
          title: frontmatter.title,
          description: frontmatter.description,
          slug,
          tags: frontmatter.tags,
          keywords: frontmatter.keywords,
          status: selectedStatus,
          contentType: selectedContentType,
          schemaTypes: frontmatter.schemaTypes,
          sourceContentId: resolvedSourceContentId,
          primaryKeyword,
          targetLocale
        },
        bodyMdx: enrichedMdx,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  const meta = {
    engine: 'codex-pipeline',
    stages: {
      outlineSections: plan.outline.length,
      generatedSections: sections.length
    }
  }

  return {
    content: result.content,
    version: result.version,
    markdown: enrichedMdx,
    meta
  }
}

// Export with new name for cleaner API
export const generateContentFromSource = async (
  db: NodePgDatabase<typeof schema>,
  input: ContentGenerationInput
): Promise<ContentGenerationResult> => {
  return generateContentDraftFromSource(db, input)
}

/**
 * Updates a content section using AI based on user instructions
 *
 * @param db - Database instance
 * @param input - Input parameters for section update
 * @returns Updated content with new version and section information
 */
export const updateContentSectionWithAI = async (
  db: NodePgDatabase<typeof schema>,
  input: SectionUpdateInput
): Promise<SectionUpdateResult> => {
  const {
    organizationId,
    userId,
    contentId,
    sectionId,
    instructions,
    temperature
  } = input

  const trimmedInstructions = instructions?.trim()

  if (!organizationId || !userId || !contentId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization, user, and content context are required'
    })
  }

  if (!trimmedInstructions) {
    throw createError({
      statusCode: 400,
      statusMessage: 'instructions are required to patch a section'
    })
  }

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion,
      sourceContent: schema.sourceContent
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no version to patch yet'
    })
  }

  const recordContent = record.content
  const currentVersion = record.version

  const normalizedSections = normalizeContentSections(
    currentVersion.sections,
    currentVersion.bodyMdx ?? null
  )

  if (!normalizedSections.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no structured sections to edit yet'
    })
  }

  const targetSection = normalizedSections.find(section => section.id === sectionId)

  if (!targetSection) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Section not found on this draft'
    })
  }

  const frontmatter = extractFrontmatterFromVersion({
    content: recordContent,
    version: currentVersion
  })

  const chunks = await ensureSourceContentChunksExist(
    db,
    record.sourceContent ?? null,
    record.sourceContent?.sourceText ?? null
  )

  const relevantChunks = await findRelevantChunksForSection({
    chunks,
    outline: {
      id: targetSection.id,
      index: targetSection.index,
      title: targetSection.title,
      type: targetSection.type,
      notes: trimmedInstructions
    },
    organizationId,
    sourceContentId: record.sourceContent?.id ?? frontmatter.sourceContentId ?? null
  })

  const contextBlock = relevantChunks.length
    ? relevantChunks.map(chunk => `Chunk ${chunk.chunkIndex}: ${chunk.text.slice(0, 600)}`).join('\n\n')
    : 'No transcript context available.'

  const prompt = [
    `You are editing a single section of a ${frontmatter.contentType}.`,
    `Section title: ${targetSection.title}`,
    `Current section body:\n${targetSection.body}`,
    `Author instructions: ${trimmedInstructions}`,
    `Frontmatter: ${JSON.stringify({
      title: frontmatter.title,
      description: frontmatter.description,
      tags: frontmatter.tags,
      contentType: frontmatter.contentType,
      schemaTypes: frontmatter.schemaTypes,
      primaryKeyword: frontmatter.primaryKeyword,
      targetLocale: frontmatter.targetLocale
    })}`,
    'Transcript context to ground this update:',
    contextBlock,
    'Respond with JSON {"body": string, "summary": string?}. Rewrite only this section content - do NOT include the section heading or title, as it will be added automatically.'
  ].join('\n\n')

  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: SECTION_PATCH_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature
  })

  const parsed = parseAIResponseAsJSON<{ body?: string, body_mdx?: string, summary?: string }>(raw, 'section patch')
  const updatedBody = (parsed.body ?? parsed.body_mdx ?? '').trim()

  if (!updatedBody) {
    throw createError({
      statusCode: 502,
      statusMessage: 'AI section patch did not return any content'
    })
  }

  const updatedSections = normalizedSections.map((section) => {
    if (section.id !== targetSection.id) {
      return section
    }

    const summary = parsed.summary?.trim() || null
    return {
      ...section,
      body: updatedBody,
      summary,
      wordCount: countWords(updatedBody),
      meta: {
        ...section.meta,
        summary
      }
    }
  })

  const assembled = assembleMarkdownFromSections({
    frontmatter,
    sections: updatedSections
  })

  const slug = record.version.frontmatter?.slug || record.content.slug
  const previousSeoSnapshot = currentVersion.seoSnapshot ?? {}
  const assets = createSectionUpdateMetadata(record.sourceContent ?? null, targetSection.id)
  const seoSnapshot = {
    ...previousSeoSnapshot,
    primaryKeyword: frontmatter.primaryKeyword,
    targetLocale: frontmatter.targetLocale,
    contentType: frontmatter.contentType,
    schemaTypes: frontmatter.schemaTypes,
    lastPatchedSectionId: targetSection.id,
    patchedAt: new Date().toISOString()
  }

  // Enrich MDX with frontmatter and JSON-LD structured data
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: assembled.markdown,
    frontmatter,
    seoSnapshot
  })

  const result = await db.transaction(async (tx) => {
    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, recordContent.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: recordContent.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: frontmatter.title,
          description: frontmatter.description ?? (record.version?.frontmatter as Record<string, any> | null)?.description,
          slug,
          tags: frontmatter.tags,
          keywords: frontmatter.keywords,
          status: frontmatter.status,
          contentType: frontmatter.contentType,
          schemaTypes: frontmatter.schemaTypes,
          sourceContentId: frontmatter.sourceContentId,
          primaryKeyword: frontmatter.primaryKeyword,
          targetLocale: frontmatter.targetLocale
        },
        bodyMdx: enrichedMdx,
        bodyHtml: null,
        sections: assembled.sections,
        assets,
        seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, recordContent.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown: enrichedMdx,
    section: {
      id: targetSection.id,
      title: targetSection.title,
      index: targetSection.index
    }
  }
}

// Export with new name for cleaner API
export const updateContentSection = async (
  db: NodePgDatabase<typeof schema>,
  input: SectionUpdateInput
): Promise<SectionUpdateResult> => {
  return updateContentSectionWithAI(db, input)
}

/**
 * Re-enriches existing content version with frontmatter and JSON-LD
 *
 * @param db - Database instance
 * @param params - Parameters for re-enrichment
 * @param params.organizationId - Organization ID
 * @param params.userId - User ID
 * @param params.contentId - Content ID
 * @param params.baseUrl - Base URL for content
 * @returns Updated content version with enriched MDX
 */
export async function reEnrichContentVersion(
  db: NodePgDatabase<typeof schema>,
  params: {
    organizationId: string
    userId: string
    contentId: string
    baseUrl?: string
  }
): Promise<{
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  enrichedMdx: string
}> {
  const { organizationId, userId: _userId, contentId, baseUrl } = params

  // Fetch content and current version
  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This content has no version to enrich'
    })
  }

  const currentVersion = record.version
  const rawFrontmatter = currentVersion.frontmatter
  const frontmatter = isValidContentFrontmatter(rawFrontmatter) ? rawFrontmatter : null
  const seoSnapshot = currentVersion.seoSnapshot as Record<string, any> | null

  if (!frontmatter) {
    console.error('[reEnrichContentVersion] Invalid or missing frontmatter', {
      contentId,
      versionId: currentVersion.id
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'Content version has no frontmatter to use for enrichment'
    })
  }

  // Extract raw markdown from existing bodyMdx (handles both enriched and non-enriched)
  if (!currentVersion.bodyMdx) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content version has no body content to enrich'
    })
  }
  const rawMarkdown = extractMarkdownFromEnrichedMdx(currentVersion.bodyMdx)

  // Re-enrich with current frontmatter and seoSnapshot
  const enrichedMdx = enrichMdxWithMetadata({
    markdown: rawMarkdown,
    frontmatter,
    seoSnapshot,
    baseUrl
  })

  // Update the current version's bodyMdx with enriched content
  const result = await db.transaction(async (tx) => {
    const [updatedVersion] = await tx
      .update(schema.contentVersion)
      .set({
        bodyMdx: enrichedMdx
        // Update updatedAt if there's such a field, otherwise just update bodyMdx
      })
      .where(eq(schema.contentVersion.id, currentVersion.id))
      .returning()

    if (!updatedVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content version'
      })
    }

    // Update content's updatedAt timestamp
    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, record.content.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: updatedVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    enrichedMdx
  }
}

// Export with new name for cleaner API
export async function refreshContentVersionMetadata(
  db: NodePgDatabase<typeof schema>,
  params: {
    organizationId: string
    userId: string
    contentId: string
    baseUrl?: string
  }
): Promise<{
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  enrichedMdx: string
}> {
  return reEnrichContentVersion(db, params)
}

// Export granular functions
export {
  assembleMarkdownFromSections,
  enrichMarkdownWithMetadata,
  extractMarkdownFromEnrichedMdx
} from './assembly'

export {
  buildChunkPreviewText,
  createTextChunks,
  ensureSourceContentChunksExist,
  findRelevantChunksForSection
} from './chunking'

export {
  createFrontmatterFromOutline,
  enrichFrontmatterWithMetadata,
  extractFrontmatterFromVersion
} from './frontmatter'

export {
  createGenerationMetadata,
  createSectionUpdateMetadata
} from './metadata'

// Export granular functions for LLM tools
export {
  generateContentOutline
} from './planning'

export {
  extractSectionContent,
  generateContentSectionsFromOutline,
  normalizeContentSections
} from './sections'

export {
  generateStructuredDataJsonLd
} from './structured-data'

// Re-export types
export type {
  ContentGenerationInput,
  ContentGenerationOverrides,
  ContentGenerationResult,
  ContentPlanDetails,
  SectionUpdateInput,
  SectionUpdateResult
} from './types'
