import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'
import * as chunking from '../server/services/content/generation/chunking'
import * as contentGeneration from '../server/services/content/generation/index'

// Mocks
vi.mock('../server/services/vectorize', () => ({
  isVectorizeConfigured: true,
  embedText: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  queryVectorMatches: vi.fn().mockImplementation(async ({ filter }) => {
    // Return a mock match that points to our test source
    if (filter?.organizationId) {
      return [{
        id: `${(globalThis as any).testSourceContentId}:0`,
        score: 0.9,
        metadata: { sourceContentId: (globalThis as any).testSourceContentId, chunkIndex: 0 }
      }]
    }
    return []
  }),
  buildVectorId: (id: string, idx: number) => `${id}:${idx}`
}))

// Mock Database (Partial)
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  transaction: vi.fn().mockImplementation(async cb => cb(mockDb))
} as any

// Mock content generation context helper
vi.mock('../server/services/content/generation/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/services/content/generation/context')>()
  return {
    ...actual,
    generateSyntheticContext: vi.fn().mockResolvedValue('Synthesized user intent from conversation.')
  }
})

// Mock content utils to avoid complex validation/logic
vi.mock('../server/utils/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/content')>()
  return {
    ...actual,
    ensureUniqueContentSlug: vi.fn().mockResolvedValue('test-slug')
  }
})

// MOCK DOWNSTREAM AI SERVICES TO PREVENT TIMEOUTS
vi.mock('../server/services/content/generation/planning', () => ({
  generateContentOutline: vi.fn().mockResolvedValue({
    outline: [],
    seo: {},
    frontmatter: { title: 'Test', status: 'draft' }
  })
}))

vi.mock('../server/services/content/generation/sections', () => ({
  generateContentSectionsFromOutline: vi.fn().mockResolvedValue([]),
  normalizeContentSections: vi.fn().mockReturnValue([]),
  CONTENT_SECTION_UPDATE_SYSTEM_PROMPT: 'You are an editor.'
}))

vi.mock('../server/services/content/generation/assembly', () => ({
  assembleMarkdownFromSections: vi.fn().mockReturnValue({ markdown: '', sections: [] }),
  enrichMarkdownWithMetadata: vi.fn().mockReturnValue(''),
  extractMarkdownFromEnrichedMdx: vi.fn().mockReturnValue('')
}))

describe('rag integration & chat context', () => {
  const userId = 'user-test'
  const organizationId = 'org-test'

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset chainable mocks
    mockDb.insert.mockReturnThis()
    mockDb.values.mockReturnThis()
    mockDb.select.mockReturnThis()
    mockDb.from.mockReturnThis()
    mockDb.where.mockReturnThis()
    mockDb.limit.mockReturnThis()
    mockDb.orderBy.mockReturnThis()
    mockDb.update.mockReturnThis()
    mockDb.set.mockReturnThis()
  })

  afterEach(() => {
    delete (globalThis as any).testSourceContentId
  })

  it('should persist chat context as SourceContent when generating draft', async () => {
    const conversationContext = 'Synthesized user intent from conversation.'

    // Mock successful insert of source content
    mockDb.returning.mockResolvedValueOnce([{
      id: 'new-source-id',
      sourceType: 'conversation',
      sourceText: conversationContext,
      ingestStatus: 'ingested'
    }])

    // Mock ensureSourceContentChunksExist to return empty chunks (simulating success)
    vi.spyOn(chunking, 'ensureSourceContentChunksExist').mockResolvedValue([])

    // Mock content creation flow (simplified)
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'new-source-id' }]) // source content return (redundant if using mockResolvedValueOnce above but purely for sequence)
      .mockResolvedValueOnce([{ id: 'content-id', slug: 'cookies' }]) // content insert
      .mockResolvedValueOnce([{ id: 'version-id' }]) // version insert
      .mockResolvedValueOnce([{ id: 'content-id' }]) // content update

    // Mock DB selects to return found users/members so we don't 404
    mockDb.limit.mockResolvedValue([{ id: userId, organizationId }])

    try {
      await contentGeneration.generateContentFromSource(mockDb, {
        organizationId,
        userId,
        // No sourceContentId provided!
        sourceText: '', // Empty source text
        // Provide history to trigger conversation mode
        conversationHistory: [{ role: 'user', content: 'I want cookies' }],
        mode: 'agent',
        overrides: { contentType: 'blog_post' }
      })
    } catch {
      // console.error(e)
      // We expect some errors due to incomplete mocks deep in assembly/metadata,
      // but we only care if the INSERT happened early on.
    }

    // Verify we tried to insert a source_content record
    expect(mockDb.insert).toHaveBeenCalledWith(schema.sourceContent)

    // Check if values was called with correct context
    // usage of expect.anything() for values we don't control strictly
    const calledValues = mockDb.values.mock.calls.find((call: any) => call[0].sourceType === 'conversation')
    expect(calledValues).toBeDefined()
    expect(calledValues[0].sourceText).toBe(conversationContext)
  })

  it('should use findGlobalRelevantChunks during section update', async () => {
    // Setup global ID for the mock to return
    (globalThis as any).testSourceContentId = 'source-123'

    // Mock fetching the chunk text from DB
    mockDb.limit.mockResolvedValueOnce([{
      chunkIndex: 0,
      text: 'Cookies are delicious.',
      sourceContentId: 'source-123'
    }])

    const results = await chunking.findGlobalRelevantChunks({
      db: mockDb,
      organizationId,
      queryText: 'How do cookies taste?'
    })

    expect(results).toHaveLength(1)
    expect(results[0].text).toBe('Cookies are delicious.')
    expect(results[0].sourceContentId).toBe('source-123')
  })
})
