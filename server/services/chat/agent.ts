/* eslint-disable perfectionist/sort-imports */
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { callChatCompletionsRaw, callChatCompletionsStream } from '~~/server/utils/aiGateway'

import type { ChatToolInvocation } from './tools'
import { getChatToolDefinitions, parseChatToolCall } from './tools'

export interface ChatAgentInput {
  conversationHistory: ChatCompletionMessage[]
  userMessage: string
  contextBlocks?: string[]
  onRetry?: (toolInvocation: ChatToolInvocation, retryCount: number) => Promise<void> | void
}

export interface ToolExecutionResult {
  success: boolean
  result?: any
  error?: string
  errorStack?: string
  sourceContentId?: string | null
  contentId?: string | null
}

export interface MultiPassAgentResult {
  finalMessage: string | null
  toolHistory: Array<{
    toolName: string
    invocation: ChatToolInvocation
    result: ToolExecutionResult
    timestamp: Date
  }>
  conversationHistory: ChatCompletionMessage[]
}

const CHAT_SYSTEM_PROMPT = `You are an autonomous content-creation assistant.

- Always analyze the user's intent from natural language.
- When the user asks you to create drafts, update sections, or otherwise modify workspace content, prefer calling the appropriate tool instead of replying with text.
- Only respond with text when the user is chatting, asking questions, or when no tool action is required.
- Keep replies concise (2-4 sentences) and actionable.
`

const MAX_TOOL_ITERATIONS = 5
const MAX_TOOL_RETRIES = 2

/**
 * LEGACY: Non-streaming agent (not used by chat API)
 *
 * This function is kept for potential internal/testing use only.
 * The chat API endpoint uses runChatAgentWithMultiPassStream exclusively.
 *
 * @deprecated Use runChatAgentWithMultiPassStream for all chat interactions
 */
export async function runChatAgentWithMultiPass({
  conversationHistory,
  userMessage,
  contextBlocks = [],
  onRetry,
  executeTool
}: ChatAgentInput & {
  executeTool: (invocation: ChatToolInvocation) => Promise<ToolExecutionResult>
}): Promise<MultiPassAgentResult> {
  const currentHistory: ChatCompletionMessage[] = [...conversationHistory]
  const toolHistory: MultiPassAgentResult['toolHistory'] = []
  let iteration = 0
  const toolRetryCounts = new Map<string, number>() // Track retries per tool

  // Add user message to history
  currentHistory.push({ role: 'user', content: userMessage })

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++

    // Run agent turn
    const contextText = contextBlocks.length ? `\n\nContext:\n${contextBlocks.join('\n\n')}` : ''
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: `${CHAT_SYSTEM_PROMPT}${contextText}` },
      ...currentHistory
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

    // Add assistant response to history
    if (assistantResponseMessage) {
      currentHistory.push(assistantResponseMessage)
    }

    // If no tool call, return the final message
    if (!toolCall) {
      return {
        finalMessage: firstChoice?.message?.content || null,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Parse and execute tool
    const toolInvocation = parseChatToolCall(toolCall)
    if (!toolInvocation) {
      // Invalid tool call, break and return
      return {
        finalMessage: firstChoice?.message?.content || 'I encountered an error processing your request.',
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Check retry count for this tool
    const toolKey = `${toolInvocation.name}:${JSON.stringify(toolInvocation.arguments)}`
    const retryCount = toolRetryCounts.get(toolKey) || 0

    if (retryCount >= MAX_TOOL_RETRIES) {
      // Max retries reached, stop and return error
      return {
        finalMessage: `I tried running ${toolInvocation.name} multiple times but it kept failing. Please try a different approach or check if there's an issue with the input.`,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Log retry if this is a retry attempt
    if (retryCount > 0 && onRetry) {
      await onRetry(toolInvocation, retryCount)
    }

    // Execute tool with error handling
    let toolResult: ToolExecutionResult
    const timestamp = new Date()
    try {
      toolResult = await executeTool(toolInvocation)
    } catch (err: any) {
      console.error(`Tool execution failed for ${toolInvocation.name}:`, err)
      toolResult = {
        success: false,
        error: err?.message || String(err),
        errorStack: err?.stack
      }
    }

    toolHistory.push({
      toolName: toolInvocation.name,
      invocation: toolInvocation,
      result: toolResult,
      timestamp
    })

    // If tool failed, increment retry count
    if (!toolResult.success) {
      toolRetryCounts.set(toolKey, retryCount + 1)
    } else {
      // Success, reset retry count
      toolRetryCounts.delete(toolKey)
    }

    // Format tool result as assistant message for next iteration
    let toolResultMessage = ''
    if (toolResult.success) {
      toolResultMessage = `Tool ${toolInvocation.name} executed successfully.`
      if (toolResult.result) {
        toolResultMessage += ` Result: ${JSON.stringify(toolResult.result)}`
      }
    } else {
      const retryInfo = retryCount > 0 ? ` (attempt ${retryCount + 1}/${MAX_TOOL_RETRIES + 1})` : ''
      toolResultMessage = `Tool ${toolInvocation.name} failed${retryInfo}: ${toolResult.error || 'Unknown error'}`
    }

    // Add tool result as tool message (tool response)
    currentHistory.push({
      role: 'tool',
      content: toolResultMessage,
      tool_call_id: toolCall.id
    })

    // Add user message acknowledging tool result (this helps the model understand the context)
    currentHistory.push({
      role: 'user',
      content: 'Continue with the next step.'
    })
  }

  // Max iterations reached
  return {
    finalMessage: 'I\'ve completed several operations, but reached the maximum number of tool calls. Is there anything else you\'d like me to do?',
    toolHistory,
    conversationHistory: currentHistory
  }
}

/**
 * Runs the agent with multi-pass orchestration and streaming support.
 * Streams LLM responses as they arrive and emits tool execution events in real-time.
 */
export async function runChatAgentWithMultiPassStream({
  conversationHistory,
  userMessage,
  contextBlocks = [],
  onLLMChunk,
  onToolStart,
  onToolComplete,
  onFinalMessage,
  onRetry,
  executeTool
}: ChatAgentInput & {
  onLLMChunk?: (chunk: string) => void
  onToolStart?: (toolName: string) => void
  onToolComplete?: (toolName: string, result: ToolExecutionResult) => void
  onFinalMessage?: (message: string) => void
  executeTool: (invocation: ChatToolInvocation) => Promise<ToolExecutionResult>
}): Promise<MultiPassAgentResult> {
  const currentHistory: ChatCompletionMessage[] = [...conversationHistory]
  const toolHistory: MultiPassAgentResult['toolHistory'] = []
  let iteration = 0
  const toolRetryCounts = new Map<string, number>() // Track retries per tool

  // Add user message to history
  currentHistory.push({ role: 'user', content: userMessage })

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++

    // Run agent turn
    const contextText = contextBlocks.length ? `\n\nContext:\n${contextBlocks.join('\n\n')}` : ''
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: `${CHAT_SYSTEM_PROMPT}${contextText}` },
      ...currentHistory
    ]

    // Stream the LLM response
    let accumulatedContent = ''
    const accumulatedToolCalls: Array<{
      id: string
      type: 'function'
      function: {
        name: string
        arguments: string
      }
    }> = []
    let responseId = ''
    let responseModel = ''

    try {
      for await (const chunk of callChatCompletionsStream({
        messages,
        tools: getChatToolDefinitions(),
        toolChoice: 'auto'
      })) {
        responseId = chunk.id || responseId
        responseModel = chunk.model || responseModel

        const [firstChoice] = chunk.choices || []
        if (!firstChoice) {
          continue
        }

        const delta = firstChoice.delta

        // Accumulate content chunks
        if (delta?.content) {
          accumulatedContent += delta.content
          // Emit chunk to callback
          if (onLLMChunk) {
            onLLMChunk(delta.content)
          }
        }

        // Accumulate tool calls
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index ?? 0
            if (!accumulatedToolCalls[index]) {
              accumulatedToolCalls[index] = {
                id: toolCallDelta.id || '',
                type: 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || ''
                }
              }
            } else {
              // Append to existing tool call
              if (toolCallDelta.function?.name) {
                accumulatedToolCalls[index].function.name = toolCallDelta.function.name
              }
              if (toolCallDelta.function?.arguments) {
                accumulatedToolCalls[index].function.arguments += toolCallDelta.function.arguments
              }
              if (toolCallDelta.id) {
                accumulatedToolCalls[index].id = toolCallDelta.id
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Streaming error:', error)
      // Return graceful error result instead of re-throwing
      const errorMessage = 'I encountered an error while processing your request. Please try again.'
      if (onFinalMessage) {
        onFinalMessage(errorMessage)
      }
      return {
        finalMessage: errorMessage,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Build the complete assistant message
    const assistantResponseMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: accumulatedContent,
      ...(accumulatedToolCalls.length > 0
        ? {
            tool_calls: accumulatedToolCalls.map(tc => ({
              id: tc.id,
              type: tc.type,
              function: tc.function
            }))
          }
        : {})
    }

    // Add assistant response to history
    currentHistory.push(assistantResponseMessage)

    // If no tool call, return the final message
    if (accumulatedToolCalls.length === 0) {
      const finalMessage = accumulatedContent || null
      if (finalMessage && onFinalMessage) {
        onFinalMessage(finalMessage)
      }
      return {
        finalMessage,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Parse and execute tool (use first tool call)
    const toolCall = accumulatedToolCalls[0]
    const toolInvocation = parseChatToolCall({
      id: toolCall.id,
      type: toolCall.type,
      function: toolCall.function
    })

    if (!toolInvocation) {
      // Invalid tool call, break and return
      const errorMessage = accumulatedContent || 'I encountered an error processing your request.'
      if (onFinalMessage) {
        onFinalMessage(errorMessage)
      }
      return {
        finalMessage: errorMessage,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Check retry count for this tool
    const toolKey = `${toolInvocation.name}:${JSON.stringify(toolInvocation.arguments)}`
    const retryCount = toolRetryCounts.get(toolKey) || 0

    if (retryCount >= MAX_TOOL_RETRIES) {
      // Max retries reached, stop and return error
      const errorMessage = `I tried running ${toolInvocation.name} multiple times but it kept failing. Please try a different approach or check if there's an issue with the input.`
      if (onFinalMessage) {
        onFinalMessage(errorMessage)
      }
      return {
        finalMessage: errorMessage,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Log retry if this is a retry attempt
    if (retryCount > 0 && onRetry) {
      await onRetry(toolInvocation, retryCount)
    }

    // Emit tool start event
    if (onToolStart) {
      onToolStart(toolInvocation.name)
    }

    // Execute tool with error handling
    let toolResult: ToolExecutionResult
    const timestamp = new Date()
    try {
      toolResult = await executeTool(toolInvocation)
    } catch (err: any) {
      console.error(`Tool execution failed for ${toolInvocation.name}:`, err)
      toolResult = {
        success: false,
        error: err?.message || String(err),
        errorStack: err?.stack
      }
    }

    toolHistory.push({
      toolName: toolInvocation.name,
      invocation: toolInvocation,
      result: toolResult,
      timestamp
    })

    // Emit tool complete event
    if (onToolComplete) {
      onToolComplete(toolInvocation.name, toolResult)
    }

    // If tool failed, increment retry count
    if (!toolResult.success) {
      toolRetryCounts.set(toolKey, retryCount + 1)
    } else {
      // Success, reset retry count
      toolRetryCounts.delete(toolKey)
    }

    // Format tool result as assistant message for next iteration
    let toolResultMessage = ''
    if (toolResult.success) {
      toolResultMessage = `Tool ${toolInvocation.name} executed successfully.`
      if (toolResult.result) {
        toolResultMessage += ` Result: ${JSON.stringify(toolResult.result)}`
      }
    } else {
      const retryInfo = retryCount > 0 ? ` (attempt ${retryCount + 1}/${MAX_TOOL_RETRIES + 1})` : ''
      toolResultMessage = `Tool ${toolInvocation.name} failed${retryInfo}: ${toolResult.error || 'Unknown error'}`
    }

    // Add tool result as tool message (tool response)
    currentHistory.push({
      role: 'tool',
      content: toolResultMessage,
      tool_call_id: toolCall.id
    })

    // Add user message acknowledging tool result (this helps the model understand the context)
    currentHistory.push({
      role: 'user',
      content: 'Continue with the next step.'
    })
  }

  // Max iterations reached
  const finalMessage = 'I\'ve completed several operations, but reached the maximum number of tool calls. Is there anything else you\'d like me to do?'
  if (onFinalMessage) {
    onFinalMessage(finalMessage)
  }
  return {
    finalMessage,
    toolHistory,
    conversationHistory: currentHistory
  }
}
