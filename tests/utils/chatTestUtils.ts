import { $fetch } from 'ofetch'

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

    const responseText = await $fetch('/api/chat?stream=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: payload
    }) as string

    // Parse SSE stream
    const parsedResponse: {
      conversationId: string | null
      conversationContentId: string | null
      messages: any[]
      logs: any[]
      agentContext: any
    } = {
      conversationId: null,
      conversationContentId: null,
      messages: [],
      logs: [],
      agentContext: null
    }
    let assistantMessage = ''

    const lines = responseText.split('\n')
    let currentEventType: string | null = null

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) {
        continue
      }

      if (trimmedLine.startsWith('event: ')) {
        currentEventType = trimmedLine.slice(7)
        continue
      }

      if (trimmedLine.startsWith('data: ')) {
        try {
          const data = JSON.parse(trimmedLine.slice(6))

          switch (currentEventType) {
            case 'conversation:update':
            case 'conversation:final':
              if (data.conversationId) {
                parsedResponse.conversationId = data.conversationId
                this.conversation.conversationId = data.conversationId
              }
              if (data.conversationContentId !== undefined) {
                parsedResponse.conversationContentId = data.conversationContentId
                this.conversation.conversationContentId = data.conversationContentId
              }
              break

            case 'message:chunk':
              assistantMessage += data.chunk || ''
              break

            case 'message:complete':
              if (data.message) {
                // Only use complete message if no chunks were accumulated
                assistantMessage = assistantMessage || data.message
              }
              break

            case 'messages:complete':
              if (data.messages) {
                parsedResponse.messages = data.messages
              }
              break

            case 'logs:complete':
              if (data.logs) {
                parsedResponse.logs = data.logs
              }
              break

            case 'agentContext:update':
              parsedResponse.agentContext = data
              break
          }
        } catch {
          // Skip malformed JSON lines
        }
        currentEventType = null
      }
    }

    // Add user message
    this.conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    })

    // Add assistant message if we captured one
    if (assistantMessage) {
      this.conversation.messages.push({
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date()
      })
    }

    return {
      ...parsedResponse,
      conversationId: parsedResponse.conversationId || this.conversation.conversationId,
      conversationContentId: parsedResponse.conversationContentId || this.conversation.conversationContentId,
      assistantMessage
    }
  }

  /**
   * Simulate a full content creation flow
   */
  async createContentFlow(topic: string, contentType: string = 'blog_post') {
    // Send natural language message - agent will handle tool selection
    const context = `Here is context about ${topic}: ${topic} has been a key part of my routine this week.`
    const response = await this.sendMessage(
      `Create a ${contentType} about ${topic}. Here's the context: ${context}`
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
  async conversationFlow(messages: string[]): Promise<any[]> {
    const responses: any[] = []

    for (const message of messages) {
      const response: any = await this.sendMessage(message)
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
   * Get conversation history
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
      conversationMaintained: responses.length > 0 && responses.every((r: any) => r.conversationId === (responses[0] as any).conversationId),
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
