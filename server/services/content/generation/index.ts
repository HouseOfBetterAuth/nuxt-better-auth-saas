// Main content generation functions
// Re-exported from generation.ts (in parent directory) with new names for cleaner API
// The actual implementations remain in generation.ts during migration
// After Phase 12, generation.ts will be deleted and functions moved here

export {
  enrichMdxWithMetadata,
  generateContentDraftFromSource as generateContentFromSource,
  reEnrichContentVersion as refreshContentVersionMetadata,
  updateContentSectionWithAI as updateContentSection
} from '../generation'

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
