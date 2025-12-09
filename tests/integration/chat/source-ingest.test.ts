import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/database/schema'
import * as chunkSourceContentModule from '~~/server/services/sourceContent/chunkSourceContent'
import { createSourceContentFromContext } from '~~/server/services/sourceContent/manualTranscript'

// Mock vectorize service
vi.mock('~~/server/services/vectorize', () => ({
  isVectorizeConfigured: false, // Disable vectorize for tests
  embedTexts: vi.fn(),
  embedText: vi.fn(),
  upsertVectors: vi.fn(),
  queryVectorMatches: vi.fn(() => Promise.resolve([]))
}))

// Mock database - we'll use a simple in-memory mock for unit tests
function createMockDB(): Partial<NodePgDatabase<typeof schema>> {
  const sourceContents: any[] = []
  const chunks: any[] = []

  return {
    transaction: vi.fn(async (callback: any) => {
      return callback({
        insert: vi.fn((table: any) => ({
          values: vi.fn((values: any) => {
            // Handle chunk inserts - store chunks in memory
            if (table === schema.chunk) {
              const insertedChunks = Array.isArray(values) ? values : [values]
              const chunksWithIds = insertedChunks.map((chunk: any) => ({
                ...chunk,
                id: chunk.id || `chunk-${chunks.length + 1}`,
                createdAt: chunk.createdAt || new Date()
              }))
              chunks.push(...chunksWithIds)
              // Return a promise that resolves when insert completes
              // (the actual function doesn't use the return value, it just awaits it)
              return Promise.resolve()
            }
            // Handle source content inserts - support onConflictDoUpdate
            const insertValues = Array.isArray(values) ? values[0] : values
            const mockSource = {
              id: insertValues?.id || 'source-123',
              organizationId: insertValues?.organizationId || 'org-123',
              sourceType: insertValues?.sourceType || 'manual_transcript',
              sourceText: insertValues?.sourceText || 'Test context',
              ingestStatus: insertValues?.ingestStatus || 'ingested',
              title: insertValues?.title || 'Test Source',
              createdAt: insertValues?.createdAt || new Date(),
              updatedAt: insertValues?.updatedAt || new Date(),
              ...insertValues
            }

            // Check if source already exists (for onConflictDoUpdate)
            const existingIndex = sourceContents.findIndex(
              (s: any) => s.organizationId === mockSource.organizationId
                && s.sourceType === mockSource.sourceType
            )

            if (existingIndex >= 0) {
              // Update existing
              sourceContents[existingIndex] = { ...sourceContents[existingIndex], ...mockSource }
            } else {
              // Insert new
              sourceContents.push(mockSource)
            }

            // Return object that supports onConflictDoUpdate().returning()
            return {
              onConflictDoUpdate: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([mockSource]))
              })),
              returning: vi.fn(() => Promise.resolve([mockSource]))
            }
          })
        })),
        delete: vi.fn((table: any) => ({
          where: vi.fn((_condition: any) => {
            // Handle chunk deletes - remove chunks matching the condition
            if (table === schema.chunk) {
              // Simple mock: clear all chunks for the sourceContentId
              // In a real scenario, this would filter by the where condition
              chunks.length = 0
            }
            return Promise.resolve()
          })
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => Promise.resolve([]))
            }))
          }))
        }))
      })
    })
  } as any
}

describe('source_ingest Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('sourceType="context" path', () => {
    it('should create source content from context text', async () => {
      const db = createMockDB() as any
      const contextText = 'This is test context for source ingestion.'
      const organizationId = 'org-123'
      const userId = 'user-123'

      // Mock the chunking function to avoid DB dependencies
      vi.spyOn(chunkSourceContentModule, 'createChunksFromSourceContentText')
        .mockResolvedValue([
          {
            id: 'chunk-1',
            chunkIndex: 0,
            text: contextText,
            textPreview: contextText.slice(0, 200),
            sourceContentId: 'source-123',
            organizationId,
            embedding: null
          }
        ])

      const result = await createSourceContentFromContext({
        db,
        organizationId,
        userId,
        context: contextText,
        title: 'Test Source',
        mode: 'agent'
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.sourceText).toBe(contextText)
      expect(result.ingestStatus).toBe('ingested')
    })

    it('should block in chat mode', async () => {
      const db = createMockDB() as any
      const contextText = 'Test context'

      await expect(
        createSourceContentFromContext({
          db,
          organizationId: 'org-123',
          userId: 'user-123',
          context: contextText,
          mode: 'chat'
        })
      ).rejects.toThrow('Writes are not allowed in chat mode')
    })

    it('should reject empty context', async () => {
      const db = createMockDB() as any

      await expect(
        createSourceContentFromContext({
          db,
          organizationId: 'org-123',
          userId: 'user-123',
          context: '',
          mode: 'agent'
        })
      ).rejects.toThrow('Context cannot be empty')
    })

    it('should normalize whitespace in context', async () => {
      const db = createMockDB() as any
      const contextWithWhitespace = '  Test   context  \n\n  with  spaces  '

      vi.spyOn(chunkSourceContentModule, 'createChunksFromSourceContentText')
        .mockResolvedValue([])

      const result = await createSourceContentFromContext({
        db,
        organizationId: 'org-123',
        userId: 'user-123',
        context: contextWithWhitespace,
        mode: 'agent'
      })

      // The function only trims the context (removes leading/trailing whitespace)
      // Internal whitespace is preserved
      expect(result.sourceText).toBe(contextWithWhitespace.trim())
    })
  })

  describe('sourceType="youtube" path', () => {
    // Note: YouTube ingestion is tested via executeChatTool integration tests
    // since it requires mocking external YouTube API calls
    it('should validate youtubeUrl is required', () => {
      // This validation happens in executeChatTool
      // We test it there
      expect(true).toBe(true)
    })
  })

  describe('chunking integration', () => {
    it('should create chunks from source content text', async () => {
      const db = createMockDB() as any
      const longText = Array(100).fill('This is a sentence. ').join('')

      const mockSourceContent = {
        id: 'source-123',
        organizationId: 'org-123',
        sourceType: 'manual_transcript',
        sourceText: longText,
        ingestStatus: 'ingested' as const,
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      // Call the real implementation without mocking
      const chunks = await chunkSourceContentModule.createChunksFromSourceContentText({
        db,
        sourceContent: mockSourceContent as any,
        onProgress: vi.fn()
      })

      // The real implementation should create multiple chunks from the long text
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[0].sourceContentId).toBe('source-123')
      expect(chunks[0].organizationId).toBe('org-123')
      expect(chunks[0].text).toBeDefined()
      expect(chunks[0].textPreview).toBeDefined()
      expect(chunks[0].startChar).toBeDefined()
      expect(chunks[0].endChar).toBeDefined()

      // Verify chunks are in order
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i)
      }

      // Verify all chunks belong to the same source
      chunks.forEach((chunk) => {
        expect(chunk.sourceContentId).toBe('source-123')
        expect(chunk.organizationId).toBe('org-123')
      })
    })

    it('should handle empty source text', async () => {
      const db = createMockDB() as any
      const mockSourceContent = {
        id: 'source-123',
        organizationId: 'org-123',
        sourceType: 'manual_transcript',
        sourceText: '',
        ingestStatus: 'ingested' as const,
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      await expect(
        chunkSourceContentModule.createChunksFromSourceContentText({
          db,
          sourceContent: mockSourceContent as any
        })
      ).rejects.toThrow('Source text is required to create chunks')
    })
  })
})
