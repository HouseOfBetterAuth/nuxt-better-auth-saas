// Main content generation functions
// Re-exported from generation.ts (in parent directory) with new names for cleaner API
// The actual implementations remain in generation.ts during migration
// After Phase 12, generation.ts will be deleted and functions moved here

export {
  generateContentDraftFromSource as generateContentFromSource,
  updateContentSectionWithAI as updateContentSection,
  reEnrichContentVersion as refreshContentVersionMetadata,
  enrichMdxWithMetadata
} from '../generation'

// Re-export types
export type {
  ContentGenerationInput,
  ContentGenerationResult,
  ContentGenerationOverrides,
  ContentPlanDetails,
  SectionUpdateInput,
  SectionUpdateResult
} from './types'

// Export granular functions for LLM tools
export {
  generateContentOutline
} from './planning'

export {
  findRelevantChunksForSection,
  ensureSourceContentChunksExist,
  createTextChunks,
  buildChunkPreviewText
} from './chunking'

export {
  generateContentSectionsFromOutline,
  normalizeContentSections,
  extractSectionContent
} from './sections'

export {
  createFrontmatterFromOutline,
  enrichFrontmatterWithMetadata,
  extractFrontmatterFromVersion
} from './frontmatter'

export {
  assembleMarkdownFromSections,
  enrichMarkdownWithMetadata,
  extractMarkdownFromEnrichedMdx
} from './assembly'

export {
  generateStructuredDataJsonLd
} from './structured-data'

export {
  createGenerationMetadata,
  createSectionUpdateMetadata
} from './metadata'
