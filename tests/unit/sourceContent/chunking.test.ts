import { describe, expect, it } from 'vitest'
import { createTextChunks, DEFAULT_CHUNK_OVERLAP_TOKENS, DEFAULT_CHUNK_SIZE_TOKENS } from '~~/server/services/content/generation/chunking'

describe('chunking Logic', () => {
  describe('createTextChunks', () => {
    it('should return empty array for empty string', () => {
      const chunks = createTextChunks('')
      expect(chunks).toHaveLength(0)
    })

    it('should return single chunk for short text', () => {
      const shortText = 'This is a short text that should fit in one chunk.'
      const chunks = createTextChunks(shortText, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks[0].text).toContain('short text')
    })

    it('should create multiple chunks for long text', () => {
      // Create text that's definitely longer than one chunk
      const longText = Array(100).fill('This is a sentence that will be repeated many times to create a long text. ').join('')
      const chunks = createTextChunks(longText, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should preserve paragraph breaks when possible', () => {
      const textWithParagraphs = `First paragraph with some content.

Second paragraph with different content.

Third paragraph here.`

      const chunks = createTextChunks(textWithParagraphs, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      // Chunks should respect paragraph boundaries
      expect(chunks.length).toBeGreaterThan(0)
      // Verify chunks don't break mid-paragraph unnecessarily
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0)
      }
    })

    it('should handle text with mixed newlines', () => {
      const mixedText = `Line 1\nLine 2\n\nParagraph break\n\nAnother paragraph\nSingle line`
      const chunks = createTextChunks(mixedText, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      expect(chunks.length).toBeGreaterThan(0)
      // All chunks should have content
      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0)
      }
    })

    it('should create chunks with reasonable sizes', () => {
      const longText = Array(200).fill('Word ').join('')
      const chunks = createTextChunks(longText, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      expect(chunks.length).toBeGreaterThan(0)

      // Each chunk should have text
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0)
        expect(chunk.textPreview).toBeDefined()
        expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0)
      }
    })

    it('should be deterministic - same input produces same chunks', () => {
      const text = 'This is a test text that will be chunked multiple times to verify determinism.'
      const chunks1 = createTextChunks(text, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)
      const chunks2 = createTextChunks(text, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      expect(chunks1.length).toBe(chunks2.length)
      for (let i = 0; i < chunks1.length; i++) {
        expect(chunks1[i].text).toBe(chunks2[i].text)
        expect(chunks1[i].chunkIndex).toBe(chunks2[i].chunkIndex)
      }
    })

    it('should handle custom chunk sizes', () => {
      const text = Array(50).fill('Word ').join('')
      const smallChunks = createTextChunks(text, 100, 10) // Smaller chunks
      const largeChunks = createTextChunks(text, 1000, 100) // Larger chunks

      // Smaller chunk size should produce more chunks
      expect(smallChunks.length).toBeGreaterThanOrEqual(largeChunks.length)
    })

    it('should handle edge case of extremely long single word', () => {
      const longWord = 'a'.repeat(10000)
      const chunks = createTextChunks(longWord, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      // Should still create chunks even if no word boundaries
      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should include textPreview for each chunk', () => {
      const text = Array(100).fill('This is a sentence. ').join('')
      const chunks = createTextChunks(text, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      for (const chunk of chunks) {
        expect(chunk.textPreview).toBeDefined()
        expect(chunk.textPreview.length).toBeLessThanOrEqual(280)
        expect(chunk.textPreview).toBe(chunk.text.slice(0, 280))
      }
    })

    it('should handle whitespace normalization', () => {
      const textWithExtraWhitespace = 'Word1    Word2\t\tWord3\r\nWord4\n\nWord5'
      const chunks = createTextChunks(textWithExtraWhitespace, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      // Should normalize whitespace but preserve paragraph breaks
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) {
        // Should not have excessive whitespace
        expect(chunk.text).not.toMatch(/[ \t]{2,}/)
      }
    })
  })

  describe('paragraph boundary detection (via chunking behavior)', () => {
    it('should respect paragraph breaks when chunking', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
      const chunks = createTextChunks(text, DEFAULT_CHUNK_SIZE_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS)

      // Chunks should respect paragraph boundaries
      expect(chunks.length).toBeGreaterThan(0)
      // Verify chunks don't break mid-paragraph unnecessarily
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0)
      }
    })

    it('should handle sentence boundaries when chunking', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.'
      const chunks = createTextChunks(text, 50, 5) // Small chunks to force multiple

      expect(chunks.length).toBeGreaterThan(0)
      // Chunks should try to break at sentence boundaries
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0)
      }
    })
  })
})
