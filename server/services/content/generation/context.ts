import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type { ContentGenerationInput } from './types'
import { callChatCompletions } from '~~/server/utils/aiGateway'

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

/**
 * Generates synthetic context from conversation history
 *
 * Extracts user intent, requirements, tone preferences, and target audience
 * from the conversation to create a context string for content generation.
 *
 * @param conversationHistory - Array of conversation messages
 * @returns Synthesized context string
 */
export async function generateSyntheticContext(
  conversationHistory: ChatCompletionMessage[]
): Promise<string> {
  // Extract user messages from conversation
  const userMessages = conversationHistory
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join('\n\n')

  if (!userMessages.trim()) {
    return 'No user intent available from conversation.'
  }

  const systemPrompt = `You are analyzing a conversation to extract key information for content generation.

Extract and synthesize:
- Main topic or subject
- Key requirements and specifications
- Tone and style preferences (if mentioned)
- Target audience (if mentioned)
- Specific points or ideas to include
- Any constraints or guidelines

Format the output as a clear, structured context that can be used to generate content.`

  const userPrompt = `Analyze this conversation and extract the key information for content generation:

${userMessages}

Provide a synthesized context that captures the user's intent and requirements:`

  try {
    const synthesis = await callChatCompletions({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 800
    })

    return synthesis.trim() || 'User intent extracted from conversation.'
  } catch (error) {
    console.error('[generateSyntheticContext] Failed to generate synthetic context:', error)
    // Fallback: return a simple summary of user messages
    return `User intent: ${userMessages.slice(0, 1000)}${userMessages.length > 1000 ? '...' : ''}`
  }
}
