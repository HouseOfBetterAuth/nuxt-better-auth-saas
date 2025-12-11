import type * as schema from '~~/server/db/schema'

export const createGenerationMetadata = (
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  stages: string[]
) => {
  return {
    generator: {
      engine: 'codex-pipeline',
      generatedAt: new Date().toISOString(),
      stages
    },
    source: sourceContent
      ? {
          id: sourceContent.id,
          type: sourceContent.sourceType,
          externalId: sourceContent.externalId
        }
      : null
  }
}

export const createSectionUpdateMetadata = (
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  sectionId: string
) => ({
  generator: {
    engine: 'codex-pipeline',
    generatedAt: new Date().toISOString(),
    stages: ['section_patch'],
    sectionId
  },
  source: sourceContent
    ? {
        id: sourceContent.id,
        type: sourceContent.sourceType,
        externalId: sourceContent.externalId
      }
    : null
})
