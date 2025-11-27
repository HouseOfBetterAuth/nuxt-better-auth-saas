import { $fetch, setup } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock auth for testing
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User'
}

const mockOrganization = {
  id: 'test-org-id',
  name: 'Test Organization'
}

// Mock auth functions at module level
vi.mock('~/server/utils/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue(mockUser)
}))

vi.mock('~/server/utils/organization', () => ({
  requireActiveOrganization: vi.fn().mockResolvedValue({
    organizationId: mockOrganization.id
  })
}))

describe('/api/chat integration', async () => {
  await setup({
    // Use test database
    nuxtConfig: {
      runtimeConfig: {
        databaseUrl: process.env.NUXT_TEST_DATABASE_URL,
        enableYoutubeIngestion: false // Disable for testing
      }
    }
  })

  beforeEach(() => {
    // Per-test setup can go here if needed
  })

  describe('basic chat functionality', () => {
    it('should handle simple text message', async () => {
      const payload = {
        message: 'Create a blog post about productivity tips'
      }

      const response = await $fetch('/api/chat', {
        method: 'POST',
        body: payload
      })

      expect(response).toHaveProperty('assistantMessage')
      expect(response).toHaveProperty('sessionId')
      expect(response.assistantMessage).toBeTruthy()
      expect(typeof response.assistantMessage).toBe('string')
    })

    it('should extract URLs from messages', async () => {
      const payload = {
        message: 'Write about this topic: https://example.com/article'
      }

      const response = await $fetch('/api/chat', {
        method: 'POST',
        body: payload
      })

      expect(response).toHaveProperty('actions')
      expect(Array.isArray(response.actions)).toBe(true)
    })
  })

  describe('content generation actions', () => {
    it('should handle generate_content action', async () => {
      const payload = {
        message: 'Generate a blog post about meditation',
        action: {
          type: 'generate_content',
          contentType: 'blog_post',
          sourceContentId: null
        }
      }

      const response = await $fetch('/api/chat', {
        method: 'POST',
        body: payload
      })

      expect(response).toHaveProperty('generation')
      expect(response.generation).toHaveProperty('content')
      expect(response.generation.content).toHaveProperty('id')
      expect(response.sessionContentId).toBe(response.generation.content.id)
    })

    it('should handle patch_section action', async () => {
      // First create content to patch
      const createPayload = {
        message: 'Create a blog post about productivity',
        action: {
          type: 'generate_content',
          contentType: 'blog_post'
        }
      }

      const createResponse = await $fetch('/api/chat', {
        method: 'POST',
        body: createPayload
      })

      const contentId = createResponse.generation.content.id

      // Now patch a section
      const patchPayload = {
        message: 'Make the introduction more engaging and add statistics',
        action: {
          type: 'patch_section',
          contentId,
          sectionId: 'intro',
          sectionTitle: 'Introduction'
        }
      }

      const patchResponse = await $fetch('/api/chat', {
        method: 'POST',
        body: patchPayload
      })

      expect(patchResponse).toHaveProperty('assistantMessage')
      expect(patchResponse.assistantMessage).toBeTruthy()
      expect(typeof patchResponse.assistantMessage).toBe('string')
      expect(patchResponse.sessionContentId).toBe(contentId)
    })
  })

  describe('session management', () => {
    it('should maintain session continuity', async () => {
      const payload1 = {
        message: 'Start a blog post about AI'
      }

      const response1 = await $fetch('/api/chat', {
        method: 'POST',
        body: payload1
      })

      const sessionId = response1.sessionId

      const payload2 = {
        message: 'Add more details about machine learning',
        sessionId
      }

      const response2 = await $fetch('/api/chat', {
        method: 'POST',
        body: payload2
      })

      expect(response2.sessionId).toBe(sessionId)
    })
  })

  describe('error handling', () => {
    it('should handle invalid action types', async () => {
      const payload = {
        message: 'Test message',
        action: {
          type: 'invalid_action'
        }
      }

      await expect($fetch('/api/chat', {
        method: 'POST',
        body: payload
      })).rejects.toThrow()
    })

    it('should handle missing required fields for patch_section', async () => {
      const payload = {
        message: 'Update section',
        action: {
          type: 'patch_section'
          // Missing contentId and sectionId
        }
      }

      await expect($fetch('/api/chat', {
        method: 'POST',
        body: payload
      })).rejects.toThrow()
    })
  })
})
