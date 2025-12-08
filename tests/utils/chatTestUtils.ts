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
   * Uses natural language - the LLM agent will determine which tools to use
   */
  async sendMessage(message: string): Promise<any> {
    const payload: any = {
      message,
      ...(this.session.sessionId && { sessionId: this.session.sessionId })
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
    // Send natural language message - agent will handle tool selection
    const transcript = `Here is a transcript about ${topic}: ${topic} has been a key part of my routine this week.`
    const response = await this.sendMessage(
      `Create a ${contentType} about ${topic}. Here's the transcript: ${transcript}`
    )

    return {
      response,
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
    // Send natural language with section context - agent will use patch_section tool
    const sectionContext = sectionTitle
      ? `Update the section titled "${sectionTitle}"`
      : `Update section ${sectionId}`
    const message = `${sectionContext}. ${instructions}`

    const response = await this.sendMessage(message)

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

    // Check if agent used tools (ingest_youtube, etc.)
    const hasToolHistory = Array.isArray(response.agentContext?.toolHistory) && response.agentContext.toolHistory.length > 0

    return {
      response,
      hasToolExecutions: hasToolHistory,
      toolCount: response.agentContext?.toolHistory?.length || 0
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
      hasContent: !!result.response?.sessionContentId,
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
      hasToolExecutions: result.hasToolExecutions,
      toolCount: result.toolCount,
      response: result.response
    }
  }
}
