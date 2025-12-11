import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type { ContentGenerationInput } from './types'

export type GenerationMode = 'conversation' | 'context' | 'hybrid'

/**
 * Determines the content generation mode based on available inputs
 *
 * @param input - Content generation input parameters
 * @returns Generation mode: 'conversation', 'context', or 'hybrid'
 */
export function determineGenerationMode(input: ContentGenerationInput): GenerationMode {
  const hasContext = Boolean(input.sourceContentId || input.sourceText)
  const hasConversation = Boolean(input.conversationHistory && input.conversationHistory.length > 0)

  if (hasContext && hasConversation) {
    return 'hybrid'
  }
  if (hasContext) {
    return 'context'
  }
  return 'conversation'
}

export function buildConversationContext(
  conversationHistory: ChatCompletionMessage[]
): string | null {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return null
  }

  const transcript = conversationHistory
    .map((message) => {
      const content = typeof message.content === 'string' ? message.content : ''
      const normalizedContent = content.trim()
      if (!normalizedContent) {
        return null
      }
      const normalizedRole = message.role
        ? `${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}`
        : 'Message'
      return `${normalizedRole}: ${normalizedContent}`
    })
    .filter((entry): entry is string => Boolean(entry))
    .join('\n\n')

  return transcript.trim() || null
}
