import { $fetch } from '@nuxt/test-utils/runtime'

export interface ChatTestSession {
  sessionId: string | null
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
  }>
  contentId: string | null
}

export class ChatTestRunner {
  private session: ChatTestSession = {
    sessionId: null,
    messages: [],
    contentId: null
  }

  /**
   * Send a message to the chat API and update session state
   */
  async sendMessage(message: string, action?: any): Promise<any> {
    const payload: any = {
      message,
      ...(this.session.sessionId && { sessionId: this.session.sessionId }),
      ...(action && { action })
    }

    const response = await $fetch('/api/chat', {
      method: 'POST',
      body: payload
    })

    // Update session state
    this.session.sessionId = response.sessionId
    this.session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    })

    if (response.assistantMessage) {
      this.session.messages.push({
        role: 'assistant',
        content: response.assistantMessage,
        timestamp: new Date()
      })
    }

    if (response.sessionContentId) {
      this.session.contentId = response.sessionContentId
    }

    return response
  }

  /**
   * Simulate a full content creation flow
   */
  async createContentFlow(topic: string, contentType: string = 'blog_post') {
    // Step 1: Initial message
    const initialResponse = await this.sendMessage(
      `Create a ${contentType} about ${topic}`
    )

    // Step 2: Generate content
    const generateResponse = await this.sendMessage(
      `Generate the content now`,
      {
        type: 'generate_content',
        contentType,
        sourceContentId: null
      }
    )

    return {
      initial: initialResponse,
      generated: generateResponse,
      contentId: this.session.contentId
    }
  }

  /**
   * Simulate a section patching flow
   */
  async patchSectionFlow(
    contentId: string,
    sectionId: string,
    instructions: string,
    sectionTitle?: string
  ) {
    const response = await this.sendMessage(instructions, {
      type: 'patch_section',
      contentId,
      sectionId,
      sectionTitle
    })

    return response
  }

  /**
   * Simulate a conversation with multiple back-and-forth messages
   */
  async conversationFlow(messages: string[]) {
    const responses = []

    for (const message of messages) {
      const response = await this.sendMessage(message)
      responses.push(response)
    }

    return responses
  }

  /**
   * Test URL processing
   */
  async testUrlProcessing(message: string, urls: string[]) {
    const messageWithUrls = `${message} ${urls.join(' ')}`
    const response = await this.sendMessage(messageWithUrls)

    return {
      response,
      hasActions: Array.isArray(response.actions) && response.actions.length > 0,
      actionCount: response.actions?.length || 0
    }
  }

  /**
   * Get current session state
   */
  getSession(): ChatTestSession {
    return { ...this.session }
  }

  /**
   * Reset session for new test
   */
  reset() {
    this.session = {
      sessionId: null,
      messages: [],
      contentId: null
    }
  }

  /**
   * Get conversation transcript
   */
  getTranscript(): string {
    return this.session.messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n\n')
  }
}

/**
 * Create a new chat test runner instance
 */
export function createChatTestRunner(): ChatTestRunner {
  return new ChatTestRunner()
}

/**
 * Test scenarios for common chat flows
 */
export const chatTestScenarios = {
  /**
   * Basic content creation scenario
   */
  async basicContentCreation(runner: ChatTestRunner) {
    const result = await runner.createContentFlow('productivity tips', 'blog_post')

    return {
      success: !!result.contentId,
      contentId: result.contentId,
      hasContent: !!result.generated.generation?.content,
      transcript: runner.getTranscript()
    }
  },

  /**
   * Section editing scenario
   */
  async sectionEditing(runner: ChatTestRunner, contentId: string) {
    const patchResult = await runner.patchSectionFlow(
      contentId,
      'intro',
      'Make the introduction more engaging and add a compelling hook',
      'Introduction'
    )

    return {
      success: patchResult.assistantMessage?.includes('Updated'),
      response: patchResult,
      transcript: runner.getTranscript()
    }
  },

  /**
   * Multi-turn conversation scenario
   */
  async multiTurnConversation(runner: ChatTestRunner) {
    const messages = [
      'I want to write about sustainable living',
      'Focus on practical tips for beginners',
      'Add a section about reducing plastic waste',
      'Make it more actionable with specific steps'
    ]

    const responses = await runner.conversationFlow(messages)

    return {
      messageCount: responses.length,
      sessionMaintained: responses.every(r => r.sessionId === responses[0].sessionId),
      transcript: runner.getTranscript()
    }
  },

  /**
   * URL processing scenario
   */
  async urlProcessing(runner: ChatTestRunner) {
    const result = await runner.testUrlProcessing(
      'Write about this topic:',
      ['https://example.com/article', 'https://blog.example.com/post']
    )

    return {
      hasActions: result.hasActions,
      actionCount: result.actionCount,
      response: result.response
    }
  }
}
