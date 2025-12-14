import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ConversationIntentSnapshot } from '~~/shared/utils/intent'
import type {
  ContentGenerationInput,
  ContentGenerationResult,
  SectionUpdateInput,
  SectionUpdateResult
} from './types'
import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'

import { callChatCompletions } from '~~/server/utils/aiGateway'
// Conversation quota is checked at chat session creation, not here
// Content generation can happen as part of existing conversations
import {
  CONTENT_TYPES,
  ensureUniqueContentSlug,
  resolveIngestMethodFromSourceContent
} from '~~/server/utils/content'
import { safeError, safeLog, safeWarn } from '~~/server/utils/safeLogger'
import { validateEnum } from '~~/server/utils/validation'
import { calculateDiffStats, findSectionLineRange } from '../diff'
import {
  assembleMarkdownFromSections,
  extractMarkdownFromEnrichedMdx
} from './assembly'
import {
  ensureSourceContentChunksExist,
  findGlobalRelevantChunks
} from './chunking'
import {
  buildConversationContext,
  determineGenerationMode
} from './context'
import {
  createFrontmatterFromOutline,
  enrichFrontmatterWithMetadata,
  extractFrontmatterFromVersion
} from './frontmatter'
import { createGenerationMetadata, createSectionUpdateMetadata } from './metadata'
import { generateContentOutline } from './planning'
import { deriveSchemaMetadata, validateSchemaMetadata } from './schemaMetadata'
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

function formatIntentSummary(snapshot?: ConversationIntentSnapshot | null): string | null {
  if (!snapshot) {
    return null
  }

  const { fields, notes } = snapshot
  const lines: string[] = []

  const append = (label: string, value: string | null | undefined) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) {
      lines.push(`${label}: ${normalized}`)
    }
  }

  append('Topic', fields.topic.value)
  append('Goal', fields.goal.value)
  append('Audience', fields.audience.value)
  append('Format', fields.format.value)
  append('Tone', fields.tone.value)

  if (Array.isArray(fields.mustInclude.value) && fields.mustInclude.value.length > 0) {
    append('Must include', fields.mustInclude.value.join('; '))
  }

  if (Array.isArray(fields.constraints.value) && fields.constraints.value.length > 0) {
    append('Constraints', fields.constraints.value.join('; '))
  }

  append('Notes', notes ?? null)

  return lines.length ? lines.join('\n') : null
}

/**
 * Gets Cloudflare Workers waitUntil if available
 * Uses dynamic import to avoid module load errors in Node.js/dev
 * Falls back to fire-and-forget in non-Workers environments
 */
async function getWaitUntil(): Promise<((promise: Promise<any>) => void) | undefined> {
  // Try to import waitUntil from cloudflare:workers (only available in Workers runtime)
  try {
    // @ts-expect-error - cloudflare:workers is only available in Workers runtime
    // Use variable to bypass static analysis/bundler resolution errors in Node
    const pkg = 'cloudflare:workers'
    const { waitUntil } = await import(pkg)
    return waitUntil
  } catch {
    // Not in Cloudflare Workers runtime - will use fire-and-forget instead
    return undefined
  }
}

// Re-export types for backward compatibility
export type {
  ContentGenerationInput as GenerateContentInput,
  ContentGenerationResult as GenerateContentResult
}

// Internal constant alias
const SECTION_PATCH_SYSTEM_PROMPT = CONTENT_SECTION_UPDATE_SYSTEM_PROMPT

/**
 * Updates chunking status in sourceContent metadata
 */
async function updateChunkingStatus(
  db: NodePgDatabase<typeof schema>,
  sourceContentId: string,
  status: 'processing' | 'completed' | 'failed',
  error?: string
) {
  // Use atomic JSONB update to avoid race conditions
  // jsonb_set can patch individual fields, but for multiple fields or deeply nested merges, || operator is better in PG
  // Here we use jsonb_build_object to construct the patch and || to merge logic

  const now = new Date().toISOString()

  let patch = sql`jsonb_build_object('chunkingStatus', ${status}::text)`

  if (status === 'failed' && error) {
    patch = sql`${patch} || jsonb_build_object('chunkingError', ${error}::text)`
  }
  if (status === 'processing') {
    patch = sql`${patch} || jsonb_build_object('chunkingStartedAt', ${now}::text)`
  }
  if (status === 'completed') {
    patch = sql`${patch} || jsonb_build_object('chunkingCompletedAt', ${now}::text)`
  }

  await db
    .update(schema.sourceContent)
    .set({
      metadata: sql`COALESCE(${schema.sourceContent.metadata}, '{}'::jsonb) || ${patch}`,
      updatedAt: new Date()
    })
    .where(eq(schema.sourceContent.id, sourceContentId))
}

/**
 * Creates a progress emitter that safely calls an optional progress callback
 */
function createProgressEmitter(
  callback: ((message: string) => Promise<void> | void) | undefined,
  context: string
) {
  return async (message: string) => {
    if (!callback)
      return
    try {
      await callback(message)
    } catch (error) {
      safeWarn(`[${context}] Progress callback failed`, { error })
    }
  }
}

/**
 * Generates a content draft from a source content (context, YouTube video, etc.)
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
    conversationHistory,
    overrides,
    systemPrompt,
    temperature,
    mode,
    event: _event,
    intentSnapshot
  } = input
  const emitProgress = createProgressEmitter(input.onProgress, 'generateContentDraftFromSource')

  // Enforce agent mode for writes
  if (mode === 'chat') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Writes are not allowed in chat mode'
    })
  }

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
    resolvedIngestMethod = 'inline_context'
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
    safeLog('[generateContentDraftFromSource] Source content found:', {
      hasId: !!sourceContent.id,
      ingestStatus: sourceContent.ingestStatus,
      sourceTextLength: resolvedSourceText?.length || 0,
      hasSourceText: !!resolvedSourceText,
      sourceType: sourceContent.sourceType,
      hasExternalId: !!sourceContent.externalId
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

  // Determine generation mode and generate synthetic context if needed
  const generationMode = determineGenerationMode(input)
  let conversationContext: string | null = null

  if (generationMode === 'conversation' || generationMode === 'hybrid') {
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = buildConversationContext(conversationHistory)
    }
  }

  const intentSummary = formatIntentSummary(intentSnapshot)

  // If no sourceText but we have conversation context, use it
  if (!resolvedSourceText && conversationContext) {
    resolvedSourceText = conversationContext
    resolvedIngestMethod = 'conversation_context'
  }

  if (!resolvedSourceText) {
    safeError('[generateContentDraftFromSource] Missing sourceText:', {
      hasSourceContentId: !!sourceContentId,
      hasSourceContent: !!sourceContent,
      sourceTextLength: resolvedSourceText?.length || 0,
      ingestStatus: sourceContent?.ingestStatus,
      hasConversationHistory: !!conversationHistory,
      conversationHistoryLength: conversationHistory?.length || 0
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'Source context is required to create a draft. Provide either sourceContentId, sourceText, or conversationHistory.'
    })
  }

  // If we have sourceContent, use its chunks
  let chunks: Awaited<ReturnType<typeof ensureSourceContentChunksExist>> | null = null
  const _resolvedSourceId = sourceContent?.id ?? null // Not currently used

  if (sourceContent) {
    chunks = await ensureSourceContentChunksExist(db, sourceContent, resolvedSourceText!)
  } else if (resolvedSourceText && resolvedIngestMethod === 'conversation_context') {
    // Persist conversation context as a SourceContent record
    // This allows the context to be chunked and embedded for RAG search
    // (edit_section uses findGlobalRelevantChunks which searches the entire org's vector index)
    // Marked as ephemeral - can be cleaned up by a periodic job for old records
    const [newSource] = await db.insert(schema.sourceContent).values({
      organizationId,
      createdByUserId: userId,
      sourceType: 'conversation', // Valid text value (not an enum)
      title: `Conversation Context - ${new Date().toLocaleString()}`,
      sourceText: resolvedSourceText,
      ingestStatus: 'pending', // Set to pending initially to match chunkingStatus
      metadata: {
        isEphemeral: true, // Mark as ephemeral for potential cleanup job
        chunkingStatus: 'pending', // Will be updated to 'processing' when chunking starts
        createdAt: new Date().toISOString()
      }
    }).returning()

    if (newSource) {
      sourceContent = newSource

      // Fail fast if status update fails
      try {
        await updateChunkingStatus(db, newSource.id, 'processing')
      } catch (err) {
        safeError('[Content Generation] Failed to update chunking status to processing:', {
          error: err instanceof Error ? err.message : 'Unknown error'
        })
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to initialize chunking status'
        })
      }

      // Chunk and embed in background using Cloudflare waitUntil or fire-and-forget
      const chunkingPromise = ensureSourceContentChunksExist(db, newSource, newSource.sourceText)
        .then(() => updateChunkingStatus(db, newSource.id, 'completed'))
        .catch(async (err) => {
          safeError('[Content Generation] Background chunking failed:', {
            error: err instanceof Error ? err.message : 'Unknown error'
          })
          await updateChunkingStatus(db, newSource.id, 'failed', err?.message || 'Unknown error')
        })

      // Use Cloudflare waitUntil if available (extends request lifetime), otherwise fire-and-forget
      // Await getting the function to ensure we don't race against response end
      const waitUntilFn = await getWaitUntil()
      if (waitUntilFn) {
        waitUntilFn(chunkingPromise)
      } else {
        // Fallback for Node.js/dev: fire-and-forget (tasks may not complete if server shuts down)
        chunkingPromise.catch((err) => {
          safeError('[Content Generation] Fire-and-forget chunking failed:', {
            error: err instanceof Error ? err.message : 'Unknown error'
          })
        })
      }

      // Don't wait for chunks - proceed with content generation
      // edit_section will check status and inform user if chunks aren't ready yet
      chunks = null
    }
  } else if (resolvedSourceText) {
    // For inline sourceText (not conversation), we typically skip chunking
    // unless we want to persist that too. For now, keeping original behavior for non-conversation inline text.
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
    sourceTitle: sourceContent?.title ?? existingContent?.title ?? null,
    conversationContext,
    intentSummary
  })
  pipelineStages.push('plan')
  await emitProgress('Outline drafted.')

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
  await emitProgress('Frontmatter prepared.')

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
    sourceContentId: frontmatter.sourceContentId ?? sourceContent?.id ?? null,
    generationMode,
    conversationContext,
    intentSummary
  })
  pipelineStages.push('sections')
  await emitProgress('Sections generated.')

  const assembled = assembleMarkdownFromSections({
    frontmatter,
    sections
  })
  pipelineStages.push('assembly')
  await emitProgress('Content assembled.')

  frontmatter = deriveSchemaMetadata(frontmatter, assembled.sections)
  const schemaValidation = validateSchemaMetadata(frontmatter)
  await emitProgress(schemaValidation.errors.length
    ? 'Schema validation detected issues.'
    : 'Schema validation passed.')

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
    schemaTypes: frontmatter.schemaTypes,
    schemaValidation
  }

  const markdown = assembled.markdown
  pipelineStages.push('markdown')

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
        bodyMdx: markdown,
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

  await emitProgress('Content saved.')

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
    markdown,
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
    temperature,
    mode,
    onProgress
  } = input
  const emitProgress = createProgressEmitter(onProgress, 'updateContentSection')

  safeLog('[updateContentSection] Starting section update', {
    hasContentId: !!contentId,
    hasSectionId: !!sectionId,
    mode,
    hasOrganizationId: !!organizationId,
    hasUserId: !!userId,
    hasInstructions: !!instructions
  })

  // Enforce agent mode for writes
  if (mode === 'chat') {
    safeError('[updateContentSection] Mode check failed - chat mode not allowed for writes', { mode })
    throw createError({
      statusCode: 403,
      statusMessage: 'Writes are not allowed in chat mode'
    })
  }

  const trimmedInstructions = instructions?.trim()

  if (!organizationId || !userId || !contentId) {
    safeError('[updateContentSection] Missing required parameters', {
      hasOrganizationId: !!organizationId,
      hasUserId: !!userId,
      hasContentId: !!contentId
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'organization, user, and content context are required'
    })
  }

  if (!trimmedInstructions) {
    safeError('[updateContentSection] Missing instructions')
    throw createError({
      statusCode: 400,
      statusMessage: 'instructions are required to patch a section'
    })
  }

  safeLog('[updateContentSection] Querying database for content', {
    hasContentId: !!contentId,
    hasOrganizationId: !!organizationId
  })
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

  // Store original section body for diff calculation
  const originalSectionBody = targetSection.body || ''

  let frontmatter = extractFrontmatterFromVersion({
    content: recordContent,
    version: currentVersion
  })

  // Check status of the specific source content linked to this record
  if (record.sourceContent?.id) {
    const sourceMeta = (record.sourceContent.metadata as Record<string, any>) || {}
    const chunkingStatus = sourceMeta.chunkingStatus

    if (chunkingStatus === 'processing' || chunkingStatus === 'pending') {
      // Check for timeout/stale job
      const startedAtStr = sourceMeta.chunkingStartedAt || sourceMeta.createdAt
      const startedAt = startedAtStr ? new Date(startedAtStr).getTime() : Date.now()
      const elapsedMinutes = (Date.now() - startedAt) / (1000 * 60)

      if (elapsedMinutes > 10) {
        // Job is stale/stuck (>10 mins). Mark as failed and proceed (on a best-effort basis)
        safeWarn('[Content Update] Found stale chunking job for source, marking failed.', {
          hasSourceContentId: !!record.sourceContent.id
        })
        await updateChunkingStatus(db, record.sourceContent.id, 'failed', 'Chunking timeout - auto-failed')
        // Proceed without throwing 503
      } else {
        // Job is still fresh, ask user to wait
        throw createError({
          statusCode: 503,
          statusMessage: 'Context is still being processed for semantic search. Please wait a moment and try again.'
        })
      }
    }
  }

  // RAG: Search global context instead of partial source
  safeLog('[updateContentSection] Starting RAG context search', {
    hasSectionTitle: !!targetSection.title,
    queryTextLength: `${targetSection.title} ${trimmedInstructions}`.length
  })
  const relevantChunks = await findGlobalRelevantChunks({
    db,
    organizationId,
    queryText: `${targetSection.title} ${trimmedInstructions}`
  })
  safeLog('[updateContentSection] RAG search completed', {
    chunksFound: relevantChunks.length
  })
  await emitProgress('Context search completed.')

  // Format context for the AI
  let contextBlock = 'No external context available.'
  if (relevantChunks.length) {
    contextBlock = relevantChunks
      .map(chunk => `[Source: ${chunk.sourceContentId?.slice(0, 8) ?? 'Unknown'}] ${chunk.text.slice(0, 600)}`)
      .join('\n\n')
  }

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
    'Context to ground this update:',
    contextBlock,
    'Respond with JSON {"body": string, "summary": string?}. Rewrite only this section content - do NOT include the section heading or title, as it will be added automatically.'
  ].join('\n\n')

  safeLog('[updateContentSection] Calling AI for section generation', {
    hasSectionTitle: !!targetSection.title,
    promptLength: prompt.length,
    temperature,
    contextChunks: relevantChunks.length
  })
  const raw = await callChatCompletions({
    messages: [
      { role: 'system', content: SECTION_PATCH_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature
  })
  safeLog('[updateContentSection] AI call completed', {
    responseLength: raw?.length || 0
  })
  await emitProgress('Section content generated.')

  const parsed = parseAIResponseAsJSON<{ body?: string, body_mdx?: string, summary?: string }>(raw, 'section patch')
  const updatedBody = (parsed.body ?? parsed.body_mdx ?? '').trim()

  if (!updatedBody) {
    safeError('[updateContentSection] AI response parsing failed - no content returned', {
      hasParsed: !!parsed,
      rawLength: raw?.length || 0
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'AI section patch did not return any content'
    })
  }

  safeLog('[updateContentSection] AI response parsed successfully', {
    bodyLength: updatedBody.length,
    hasSummary: !!parsed.summary
  })

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
  await emitProgress('Section assembled.')
  const lineRange = findSectionLineRange(
    assembled.markdown,
    targetSection.id,
    assembled.sections
  )

  frontmatter = deriveSchemaMetadata(frontmatter, assembled.sections)

  const diffStats = calculateDiffStats(originalSectionBody, updatedBody)

  safeLog('[updateContentSection] Calculated diff stats', {
    originalLength: originalSectionBody.length,
    updatedLength: updatedBody.length,
    additions: diffStats.additions,
    deletions: diffStats.deletions,
    hasChanges: originalSectionBody !== updatedBody
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
    patchedAt: new Date().toISOString(),
    schemaValidation
  }

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
          targetLocale: frontmatter.targetLocale,
          diffStats: {
            additions: diffStats.additions,
            deletions: diffStats.deletions
          }
        },
        bodyMdx: assembled.markdown,
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

  await emitProgress('Section update saved.')

  return {
    content: result.content,
    version: result.version,
    markdown: assembled.markdown,
    section: {
      id: targetSection.id,
      title: targetSection.title,
      index: targetSection.index
    },
    lineRange: lineRange || null,
    diffStats
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
 * Normalizes an existing content version so that bodyMdx stores raw markdown only.
 *
 * @param db - Database instance
 * @param params - Parameters for normalization
 * @param params.organizationId - Organization ID
 * @param params.userId - User ID
 * @param params.contentId - Content ID
 * @param params.baseUrl - Base URL for content (unused, kept for backwards compatibility)
 * @returns Updated content version with normalized markdown
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
  markdown: string
}> {
  const { organizationId, userId: _userId, contentId, baseUrl: _baseUrl } = params

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

  if (!frontmatter) {
    safeError('[reEnrichContentVersion] Invalid or missing frontmatter', {
      hasContentId: !!contentId,
      hasVersionId: !!currentVersion.id
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

  // Update the current version's bodyMdx to store normalized markdown only
  const result = await db.transaction(async (tx) => {
    const [updatedVersion] = await tx
      .update(schema.contentVersion)
      .set({
        bodyMdx: rawMarkdown
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
    markdown: rawMarkdown
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
  markdown: string
}> {
  return reEnrichContentVersion(db, params)
}

// Export granular functions
export {
  assembleMarkdownFromSections,
  enrichMarkdownWithMetadata,
  extractMarkdownFromEnrichedMdx
} from './assembly'

export { enrichMarkdownWithMetadata as enrichMdxWithMetadata } from './assembly'

export {
  buildChunkPreviewText,
  createTextChunks,
  ensureSourceContentChunksExist,
  findGlobalRelevantChunks
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
