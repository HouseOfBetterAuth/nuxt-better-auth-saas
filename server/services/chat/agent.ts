/* eslint-disable perfectionist/sort-imports */
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import { callChatCompletionsStream } from '~~/server/utils/aiGateway'

import type { ChatToolInvocation } from './tools'
import { getChatToolDefinitions, getToolsByKind, parseChatToolCall } from './tools'

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

function buildSystemPrompt(mode: 'chat' | 'agent'): string {
  const basePrompt = `You are an autonomous content-creation assistant.`

  if (mode === 'chat') {
    return `${basePrompt}

- You are in **read-only mode**. You can use read tools to explore the workspace:
  - read_content: Fetch a content item and its current version
  - read_section: Fetch a specific section of a content item
  - read_source: Fetch a source content item (e.g., context, YouTube)
  - read_content_list: List content items with optional filtering
  - read_source_list: List source content items with optional filtering
  - read_workspace_summary: Get a formatted summary of a content workspace
- You MUST NOT perform actions that modify content or ingest new data.
- If the user asks you to make changes, explain what you would do and suggest switching to agent mode for actual changes.
- Keep replies concise (2-4 sentences) and helpful.`
  }

  return `${basePrompt}

- Always analyze the user's intent from natural language.
- When the user asks you to create content, update sections, or otherwise modify workspace artifacts, prefer calling the appropriate tool instead of replying with text.
- Only respond with text when the user is chatting, asking questions, or when no tool action is required.
- Keep replies concise (2-4 sentences) and actionable.

**Tool Selection Guidelines:**
- For simple edits to metadata (title, slug, status, primaryKeyword, targetLocale, contentType) on existing content items, use edit_metadata. Examples: "make the title shorter", "change the status to published", "update the slug".
- For editing specific sections of existing content, use edit_section. Examples: "make the introduction more engaging", "rewrite the conclusion".
- For creating new content items from source content (context, YouTube video, etc.), use content_write with action="create". This tool only creates new content - it cannot update existing content.
- For refreshing an existing content item's frontmatter and JSON-LD structured data, use content_write with action="enrich".
- For ingesting source content from YouTube videos or pasted text, use source_ingest with sourceType="youtube" or sourceType="context".
- Never use content_write with action="create" for editing existing content - use edit_metadata or edit_section instead.`
}

const MAX_TOOL_ITERATIONS = 5
const MAX_TOOL_RETRIES = 2

/**
 * Runs the agent with multi-pass orchestration and streaming support.
 * Streams LLM responses as they arrive and emits tool execution events in real-time.
 */
export async function runChatAgentWithMultiPassStream({
  mode,
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
  mode: 'chat' | 'agent'
  onLLMChunk?: (chunk: string) => void
  onToolStart?: (toolCallId: string, toolName: string) => void
  onToolComplete?: (toolCallId: string, toolName: string, result: ToolExecutionResult) => void
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
      { role: 'system', content: `${buildSystemPrompt(mode)}${contextText}` },
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

    let tools

    try {
      // Select tools based on mode: chat mode only gets read tools, agent mode gets all tools
      const allTools = getChatToolDefinitions()
      tools = mode === 'chat'
        ? getToolsByKind('read') // only read tools in chat mode
        : allTools // full toolset in agent mode

      // Log agent context before calling AI Gateway
      console.log('[Agent] Calling AI Gateway with context:', {
        mode,
        iteration,
        messageCount: messages.length,
        systemPromptLength: messages.find(m => m.role === 'system')?.content?.length || 0,
        toolCount: tools.length,
        toolNames: tools.map(t => t.function?.name).filter(Boolean),
        contextBlocksCount: contextBlocks.length,
        userMessageLength: userMessage.length,
        conversationHistoryLength: conversationHistory.length
      })

      for await (const chunk of callChatCompletionsStream({
        messages,
        tools,
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
      // Extract detailed error information
      const errorMessage = error?.message || error?.data?.message || error?.statusMessage || 'Unknown error'
      const errorStatus = error?.statusCode || error?.status || 'N/A'

      // Log comprehensive error details with full context
      // Note: tools may not be defined if error occurred before tool selection
      let toolCount = 0
      let toolNames: string[] = []
      try {
        // Try to get tools if they were defined
        if (typeof tools !== 'undefined') {
          toolCount = tools.length
          toolNames = tools.map(t => t.function?.name).filter(Boolean)
        } else {
          // Tools not defined - this indicates error occurred during tool selection phase
          console.error('[Agent] ERROR: tools variable is not defined in catch block - this is a code bug!')
          console.error('[Agent] Error occurred before tools could be selected. Mode:', mode)
        }
      } catch (toolError) {
        console.error('[Agent] Failed to access tools in error handler:', toolError)
      }

      const isDev = process.env.NODE_ENV === 'development'

      const agentErrorContext = {
        mode,
        iteration,
        message: errorMessage,
        status: errorStatus,
        stack: isDev && error instanceof Error ? error.stack : undefined,
        // Context about what was being attempted
        messageCount: messages.length,
        systemPromptLength: messages.find(m => m.role === 'system')?.content?.length || 0,
        toolCount,
        toolNames,
        toolsDefined: typeof tools !== 'undefined',
        contextBlocksCount: contextBlocks.length,
        userMessageLength: userMessage.length,
        conversationHistoryLength: conversationHistory.length,
        accumulatedContentLength: accumulatedContent.length,
        accumulatedToolCallsCount: accumulatedToolCalls.length
      }

      console.error('[Agent] Streaming error with full context:', agentErrorContext)

      // Return graceful error result instead of re-throwing
      // Add any accumulated content to history for consistency
      if (accumulatedContent || accumulatedToolCalls.length > 0) {
        currentHistory.push({
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
        })
      }
      // Include error details in development mode for debugging
      const errorDetails = errorMessage
      const userErrorMessage = isDev && errorDetails
        ? `I encountered an error while processing your request: ${errorDetails}`
        : 'I encountered an error while processing your request. Please try again.'
      if (onFinalMessage) {
        onFinalMessage(userErrorMessage)
      }
      return {
        finalMessage: userErrorMessage,
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

    // Parse and execute all tool calls in batch
    const maxRetryFailedTools: Array<{ toolCall: typeof accumulatedToolCalls[0], toolInvocation: ChatToolInvocation }> = []

    for (const toolCall of accumulatedToolCalls) {
      const toolInvocation = parseChatToolCall({
        id: toolCall.id,
        type: toolCall.type,
        function: toolCall.function
      })

      if (!toolInvocation) {
        // Invalid tool call, skip and continue with next one
        console.warn(`Invalid tool call skipped: ${toolCall.id}`)
        continue
      }

      // Check retry count for this tool
      const toolKey = `${toolInvocation.name}:${JSON.stringify(toolInvocation.arguments)}`
      const retryCount = toolRetryCounts.get(toolKey) || 0

      if (retryCount >= MAX_TOOL_RETRIES) {
        // Max retries reached, add to failed tools list and continue processing remaining tools
        maxRetryFailedTools.push({ toolCall, toolInvocation })
        continue
      }

      // Log retry if this is a retry attempt
      if (retryCount > 0 && onRetry) {
        await onRetry(toolInvocation, retryCount)
      }

      // Generate unique ID for this tool call (for tracking concurrent executions)
      const toolCallId = toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`

      // Emit tool start event with unique ID
      if (onToolStart) {
        onToolStart(toolCallId, toolInvocation.name)
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
          result: null,
          error: err?.message || 'Tool execution failed'
        }
      }

      // Emit tool complete event with unique ID
      if (onToolComplete) {
        onToolComplete(toolCallId, toolInvocation.name, toolResult)
      }

      // Add tool result to history
      toolHistory.push({
        toolName: toolInvocation.name,
        invocation: toolInvocation,
        result: toolResult,
        timestamp
      })

      currentHistory.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id
      })
      if (!toolResult.success) {
        toolRetryCounts.set(toolKey, retryCount + 1)
      } else {
        // Success, reset retry count
        toolRetryCounts.delete(toolKey)
      }

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
    }

    // Process tools that hit max retries - add placeholder error responses
    for (const { toolCall, toolInvocation } of maxRetryFailedTools) {
      const timestamp = new Date()
      const errorMessage = `I tried running ${toolInvocation.name} multiple times but it kept failing. Please try a different approach or check if there's an issue with the input.`

      // Create placeholder error response matching ToolExecutionResult structure
      const placeholderResult: ToolExecutionResult = {
        success: false,
        error: errorMessage
      }

      // Add to toolHistory with same structure as real tool responses
      toolHistory.push({
        toolName: toolInvocation.name,
        invocation: toolInvocation,
        result: placeholderResult,
        timestamp
      })

      // Emit tool start and complete events for consistency
      if (onToolStart) {
        onToolStart(toolInvocation.name)
      }
      if (onToolComplete) {
        onToolComplete(toolInvocation.name, placeholderResult)
      }

      // Add tool result as tool message (tool response) to conversation history
      currentHistory.push({
        role: 'tool',
        content: `Tool ${toolInvocation.name} failed after ${MAX_TOOL_RETRIES + 1} attempts: ${errorMessage}`,
        tool_call_id: toolCall.id
      })
    }

    // If any tools hit max retries, return with aggregated error message
    if (maxRetryFailedTools.length > 0) {
      const failedToolNames = maxRetryFailedTools.map(({ toolInvocation }) => toolInvocation.name)
      const errorMessage = failedToolNames.length === 1
        ? `I tried running ${failedToolNames[0]} multiple times but it kept failing. Please try a different approach or check if there's an issue with the input.`
        : `I tried running the following tools multiple times but they kept failing: ${failedToolNames.join(', ')}. Please try a different approach or check if there's an issue with the input.`

      if (onFinalMessage) {
        onFinalMessage(errorMessage)
      }
      return {
        finalMessage: errorMessage,
        toolHistory,
        conversationHistory: currentHistory
      }
    }

    // Add user message acknowledging tool results (this helps the model understand the context)
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
