import { setup } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import { chatTestScenarios, createChatTestRunner } from '../utils/chatTestUtils'

describe('chat Codex Experience', async () => {
  await setup({
    nuxtConfig: {
      runtimeConfig: {
        databaseUrl: process.env.NUXT_TEST_DATABASE_URL,
        enableYoutubeIngestion: false
      }
    }
  })

  let chatRunner: ReturnType<typeof createChatTestRunner>

  beforeEach(() => {
    chatRunner = createChatTestRunner()
  })

  describe('complete Content Creation Flow', () => {
    it('should create content from scratch through conversation', async () => {
      const result = await chatTestScenarios.basicContentCreation(chatRunner)

      expect(result.success).toBe(true)
      expect(result.contentId).toBeTruthy()
      expect(result.hasContent).toBe(true)

      console.log('Content Creation Transcript:')
      console.log(result.transcript)
    })

    it('should handle iterative content refinement', async () => {
      // First create content
      const creation = await chatTestScenarios.basicContentCreation(chatRunner)
      expect(creation.success).toBe(true)

      // Then edit sections
      const editing = await chatTestScenarios.sectionEditing(chatRunner, creation.contentId!)
      expect(editing.success).toBe(true)

      console.log('Content Refinement Transcript:')
      console.log(editing.transcript)
    })
  })

  describe('conversational Intelligence', () => {
    it('should maintain context across multiple messages', async () => {
      const result = await chatTestScenarios.multiTurnConversation(chatRunner)

      expect(result.messageCount).toBe(4)
      expect(result.sessionMaintained).toBe(true)

      console.log('Multi-turn Conversation Transcript:')
      console.log(result.transcript)
    })

    it('should handle complex instructions', async () => {
      const response = await chatRunner.sendMessage(
        'Create a comprehensive guide about remote work productivity. Include sections on workspace setup, time management, communication tools, and work-life balance. Make it actionable with specific tips and tools recommendations.'
      )

      expect(response.assistantMessage).toBeTruthy()
      expect(response.sessionId).toBeTruthy()

      // Generate the content
      const generated = await chatRunner.sendMessage('Generate this content now', {
        type: 'generate_content',
        contentType: 'how_to',
        sourceContentId: null
      })

      expect(generated.generation).toBeTruthy()
      expect(generated.generation.content).toBeTruthy()
    })
  })

  describe('content Type Flexibility', () => {
    it('should handle different content types', async () => {
      const contentTypes = ['blog_post', 'how_to', 'recipe', 'course']

      for (const contentType of contentTypes) {
        chatRunner.reset()

        const result = await chatRunner.createContentFlow(
          `test topic for ${contentType}`,
          contentType
        )

        expect(result.contentId).toBeTruthy()
        expect(result.generated.generation?.content).toBeTruthy()
      }
    })
  })

  describe('error Recovery', () => {
    it('should handle and recover from errors gracefully', async () => {
      // Try invalid action
      try {
        await chatRunner.sendMessage('Test message', {
          type: 'invalid_action'
        })
      } catch (error) {
        expect(error).toBeTruthy()
      }

      // Should still work with valid message after error
      const recovery = await chatRunner.sendMessage('Create a simple blog post about cats')
      expect(recovery.assistantMessage).toBeTruthy()
      expect(recovery.sessionId).toBeTruthy()
    })

    it('should handle missing content for patch operations', async () => {
      try {
        await chatRunner.sendMessage('Update the introduction', {
          type: 'patch_section',
          contentId: 'non-existent-id',
          sectionId: 'intro'
        })
      } catch (error) {
        expect(error).toBeTruthy()
      }
    })
  })

  describe('performance and Reliability', () => {
    it('should handle rapid message sequences', async () => {
      const messages = [
        'Start a blog post about AI',
        'Add more technical details',
        'Include practical examples',
        'Make it more beginner-friendly',
        'Add a conclusion'
      ]

      const startTime = Date.now()
      const responses = await chatRunner.conversationFlow(messages)
      const endTime = Date.now()

      expect(responses).toHaveLength(5)
      expect(responses.every(r => r.assistantMessage)).toBe(true)
      expect(endTime - startTime).toBeLessThan(30000) // Should complete within 30 seconds

      console.log(`Rapid sequence completed in ${endTime - startTime}ms`)
    })

    it('should maintain session integrity under load', async () => {
      const initialSessionId = (await chatRunner.sendMessage('Hello')).sessionId

      // Send multiple messages
      for (let i = 0; i < 10; i++) {
        const response = await chatRunner.sendMessage(`Message ${i + 1}`)
        expect(response.sessionId).toBe(initialSessionId)
      }
    })
  })

  describe('real-world Scenarios', () => {
    it('should handle a complete blog writing workflow', async () => {
      // Step 1: Initial idea
      const idea = await chatRunner.sendMessage(
        'I want to write a blog post about the benefits of meditation for busy professionals'
      )
      expect(idea.assistantMessage).toBeTruthy()

      // Step 2: Generate content
      const generated = await chatRunner.sendMessage('Create this blog post', {
        type: 'generate_content',
        contentType: 'blog_post'
      })
      expect(generated.generation?.content).toBeTruthy()

      const contentId = generated.generation.content.id

      // Step 3: Refine introduction
      const refinedIntro = await chatRunner.patchSectionFlow(
        contentId,
        'intro',
        'Make the introduction more compelling with a personal anecdote',
        'Introduction'
      )
      expect(refinedIntro.assistantMessage).toContain('Updated')

      // Step 4: Add more details to a section
      const enhanced = await chatRunner.patchSectionFlow(
        contentId,
        'benefits',
        'Add scientific studies and statistics to support the benefits',
        'Benefits of Meditation'
      )
      expect(enhanced.assistantMessage).toContain('Updated')

      console.log('Complete Blog Workflow Transcript:')
      console.log(chatRunner.getTranscript())
    })

    it('should handle recipe creation workflow', async () => {
      const recipe = await chatRunner.createContentFlow(
        'chocolate chip cookies',
        'recipe'
      )

      expect(recipe.contentId).toBeTruthy()

      // Refine the recipe
      const refined = await chatRunner.patchSectionFlow(
        recipe.contentId!,
        'ingredients',
        'Add measurements in both metric and imperial units',
        'Ingredients'
      )

      expect(refined.assistantMessage).toContain('Updated')
    })
  })
})
