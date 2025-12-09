import { $fetch } from '@nuxt/test-utils/runtime'

export interface ChatTestConversation {
  conversationId: string | null
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
  }>
  conversationContentId: string | null
}

export class ChatTestRunner {
  private conversation: ChatTestConversation = {
    conversationId: null,
    messages: [],
    conversationContentId: null
  }

  /**
   * Send a message to the chat API and update conversation state
   * Uses natural language - the LLM agent will determine which tools to use
   */
  async sendMessage(message: string, mode: 'chat' | 'agent' = 'agent'): Promise<any> {
    const payload: any = {
      message,
      mode,
      ...(this.conversation.conversationId && { conversationId: this.conversation.conversationId })
    }

    const response = await $fetch('/api/chat?stream=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: payload
    })

    // Note: The API now returns SSE stream, so we need to parse it
    // For test purposes, we'll extract conversationId from the stream
    // This is a simplified implementation - real tests should parse SSE properly
    // Update conversation state from response (if available)
    // The actual implementation would parse the SSE stream for conversation:update events
    this.conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    })

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
      contentId: this.conversation.conversationContentId
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
   * Get current conversation state
   */
  getConversation(): ChatTestConversation {
    return { ...this.conversation }
  }

  /**
   * Reset conversation for new test
   */
  reset() {
    this.conversation = {
      conversationId: null,
      messages: [],
      conversationContentId: null
    }
  }

  /**
   * Get conversation transcript
   */
  getTranscript(): string {
    return this.conversation.messages
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
      hasContent: !!result.response?.conversationContentId,
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
      conversationMaintained: responses.every(r => r.conversationId === responses[0].conversationId),
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
