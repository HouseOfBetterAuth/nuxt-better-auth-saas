/* eslint-disable perfectionist/sort-imports */
import type { ChatCompletionMessage, ChatCompletionToolCall } from '~~/server/utils/aiGateway'
import { callChatCompletionsRaw } from '~~/server/utils/aiGateway'

import type { ChatToolInvocation } from './tools'
import { getChatToolDefinitions, parseChatToolCall } from './tools'

export interface ChatAgentInput {
  conversationHistory: ChatCompletionMessage[]
  userMessage: string
  contextBlocks?: string[]
}

export interface ChatAgentResult {
  toolInvocation?: ChatToolInvocation | null
  assistantMessage?: string | null
  promptMessages: ChatCompletionMessage[]
  assistantResponseMessage?: ChatCompletionMessage | null
  toolCall?: ChatCompletionToolCall | null
}

const CHAT_SYSTEM_PROMPT = `You are an autonomous content-creation assistant.

- Always analyze the user's intent from natural language.
- When the user asks you to create drafts, update sections, or otherwise modify workspace content, prefer calling the appropriate tool instead of replying with text.
- Only respond with text when the user is chatting, asking questions, or when no tool action is required.
- Keep replies concise (2-4 sentences) and actionable.
`

export async function runChatAgentTurn({
  conversationHistory,
  userMessage,
  contextBlocks = []
}: ChatAgentInput): Promise<ChatAgentResult> {
  const contextText = contextBlocks.length ? `\n\nContext:\n${contextBlocks.join('\n\n')}` : ''
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: `${CHAT_SYSTEM_PROMPT}${contextText}` },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ]

  const response = await callChatCompletionsRaw({
    messages,
    tools: getChatToolDefinitions(),
    toolChoice: 'auto'
  })

  const [firstChoice] = response.choices
  const toolCall = firstChoice?.message?.tool_calls?.[0] ?? null
  const assistantResponseMessage: ChatCompletionMessage | null = firstChoice?.message
    ? {
        role: 'assistant',
        content: firstChoice.message.content ?? '',
        ...(firstChoice.message.tool_calls?.length ? { tool_calls: firstChoice.message.tool_calls } : {})
      }
    : null

  if (toolCall) {
    return {
      toolInvocation: parseChatToolCall(toolCall),
      assistantMessage: firstChoice?.message?.content || null,
      promptMessages: messages,
      assistantResponseMessage,
      toolCall
    }
  }

  return {
    assistantMessage: firstChoice?.message?.content || null,
    promptMessages: messages,
    assistantResponseMessage,
    toolCall: null
  }
}
