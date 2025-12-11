import type { ChatCompletionMessage } from '../server/utils/aiGateway'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'
import * as chunking from '../server/services/content/generation/chunking'
import { buildConversationContext } from '../server/services/content/generation/context'
import * as contentGeneration from '../server/services/content/generation/index'

// Mocks
vi.mock('../server/services/vectorize', () => ({
  isVectorizeConfigured: true,
  embedText: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  queryVectorMatches: vi.fn().mockResolvedValue([]),
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

vi.mock('../server/services/content/generation/frontmatter', () => ({
  createFrontmatterFromOutline: vi.fn().mockReturnValue({ title: 'Test', status: 'draft', contentType: 'blog_post' }),
  enrichFrontmatterWithMetadata: vi.fn().mockReturnValue({ title: 'Test', status: 'draft', contentType: 'blog_post' }),
  extractFrontmatterFromVersion: vi.fn().mockReturnValue({
    title: 'Test',
    description: 'Test Desc',
    tags: [],
    contentType: 'blog_post',
    schemaTypes: [],
    primaryKeyword: 'test',
    targetLocale: 'en'
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

  it('should persist chat context as SourceContent when generating draft', async () => {
    const conversationHistory: ChatCompletionMessage[] = [{ role: 'user', content: 'I want cookies' }]
    const conversationContext = buildConversationContext(conversationHistory) ?? ''

    // Mock successful insert of source content
    mockDb.returning.mockResolvedValueOnce([{
      id: 'new-source-id',
      sourceType: 'conversation',
      sourceText: conversationContext,
      ingestStatus: 'ingested'
    }])

    // Mock ensureSourceContentChunksExist to return empty chunks (simulating success)
    vi.spyOn(chunking, 'ensureSourceContentChunksExist').mockResolvedValue([])

    // Mock content creation flow
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'new-source-id' }]) // returned from insert source
      .mockResolvedValueOnce([{ id: 'content-id', slug: 'cookies' }]) // insert content
      .mockResolvedValueOnce([{ id: 'version-id' }]) // insert version
      .mockResolvedValueOnce([{ id: 'content-id' }]) // update content timestamp

    // Mock DB selects
    mockDb.limit.mockResolvedValue([{ id: userId, organizationId }])

    await contentGeneration.generateContentFromSource(mockDb, {
      organizationId,
      userId,
      sourceText: '', // Empty source text
      // Provide history to trigger conversation mode
      conversationHistory,
      mode: 'agent',
      overrides: { contentType: 'blog_post' }
    })

    // Verify we tried to insert a source_content record
    expect(mockDb.insert).toHaveBeenCalledWith(schema.sourceContent)

    // Check if values was called with correct context
    const calledValues = mockDb.values.mock.calls.find((call: any) => call[0].sourceType === 'conversation')
    expect(calledValues).toBeDefined()
    expect(calledValues![0].sourceText).toBe(conversationContext)
  })

  it('should use findGlobalRelevantChunks during section update', async () => {
    const { queryVectorMatches } = await import('../server/services/vectorize')

    // Override the mock for this specific test
    vi.mocked(queryVectorMatches).mockResolvedValueOnce([{
      id: 'source-123:0',
      score: 0.9,
      metadata: { sourceContentId: 'source-123', chunkIndex: 0 }
    }])

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
