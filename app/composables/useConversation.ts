import type { ContentType } from '#shared/constants/contentTypes'
import type {
  ChatLogEntry,
  ChatMessage,
  NonEmptyArray
} from '#shared/utils/types'
import { useState } from '#app'
import { DEFAULT_CONTENT_TYPE } from '#shared/constants/contentTypes'
import { computed } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface AgentContext {
  readySources?: Array<{
    id: string
    title: string | null
    sourceType: string | null
    ingestStatus: string
    createdAt: Date | string
    updatedAt: Date | string
  }>
  ingestFailures?: Array<{
    content: string
    payload?: Record<string, any> | null
  }>
  lastAction?: string | null
  toolHistory?: Array<{
    toolName: string
    timestamp: Date | string
    status: string
  }>
}

interface ChatResponse {
  assistantMessage?: string
  conversationId?: string | null
  conversationContentId?: string | null
  agentContext?: AgentContext
  messages?: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content?: string
    parts?: Array<{ type: 'text', text: string }>
    createdAt: string | Date
    payload?: Record<string, any> | null
  }>
  logs?: Array<{
    id: string
    type: string
    message: string
    payload?: Record<string, any> | null
    createdAt: string | Date
  }>
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function toDate(value: string | Date) {
  if (value instanceof Date) {
    return value
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

function normalizeMessages(list: ChatResponse['messages']): ChatMessage[] {
  if (!Array.isArray(list)) {
    return []
  }
  return list
    .filter(message => message && (message.role === 'assistant' || message.role === 'user'))
    .map((message) => {
      const parts = Array.isArray(message.parts) && message.parts.length > 0
        ? message.parts
        : [{ type: 'text' as const, text: message.content || '' }]
      // Ensure parts is non-empty
      if (parts.length === 0) {
        parts.push({ type: 'text' as const, text: '' })
      }
      return {
        id: message.id || createId(),
        role: message.role as ChatMessage['role'],
        parts: parts as NonEmptyArray<{ type: 'text', text: string }>,
        createdAt: toDate(message.createdAt),
        payload: message.payload ?? null
      }
    })
}

function normalizeLogs(list: ChatResponse['logs']) {
  if (!Array.isArray(list)) {
    return []
  }
  return list.map(log => ({
    id: log.id,
    type: log.type,
    message: log.message,
    payload: log.payload ?? null,
    createdAt: toDate(log.createdAt)
  }))
}

export function useConversation() {
  const messages = useState<ChatMessage[]>('chat/messages', () => [])
  const status = useState<ChatStatus>('chat/status', () => 'ready')
  const errorMessage = useState<string | null>('chat/error', () => null)
  const selectedContentType = useState<ContentType>('chat/content-type', () => DEFAULT_CONTENT_TYPE)
  const conversationId = useState<string | null>('chat/conversation-id', () => null)
  const conversationContentId = useState<string | null>('chat/conversation-content-id', () => null)
  const logs = useState<ChatLogEntry[]>('chat/logs', () => [])
  const requestStartedAt = useState<Date | null>('chat/request-started-at', () => null)
  const activeController = useState<AbortController | null>('chat/active-controller', () => null)
  const agentContext = useState<AgentContext | null>('chat/agent-context', () => null)
  const prompt = useState<string>('chat/prompt', () => '')
  const mode = useState<'chat' | 'agent'>('chat/mode', () => 'chat')
  const currentActivity = useState<'llm_thinking' | 'tool_executing' | 'streaming_message' | null>('chat/current-activity', () => null)
  const currentToolName = useState<string | null>('chat/current-tool-name', () => null)

  const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')

  function withSelectedContentType(body: Record<string, any> = {}) {
    const contentType = selectedContentType.value
    const nextBody: Record<string, any> = {
      ...body,
      contentType
    }
    // Note: contentType is now passed as a separate field, not in action
    // The agent will use it from context if needed
    return nextBody
  }

  async function callChatEndpoint(body: Record<string, any>) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    requestStartedAt.value = new Date()
    status.value = 'submitted'
    errorMessage.value = null
    currentActivity.value = 'llm_thinking' // Initial state - LLM is thinking about the request
    currentToolName.value = null

    if (activeController.value) {
      activeController.value.abort()
    }
    activeController.value = controller

    try {
      status.value = 'streaming'
      const payload = withSelectedContentType(body)
      if (conversationId.value) {
        payload.conversationId = conversationId.value
      }

      // Chat API is streaming-only (SSE)
      const url = '/api/chat?stream=true'
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload),
        signal: controller?.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.statusMessage || errorData.message || `HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Parse SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentAssistantMessageId: string | null = null
      let currentAssistantMessageText = ''
      let pendingEventType: string | null = null
      // Activity state management: tool:start/tool:complete events take precedence over log:entry events
      // This ensures consistent behavior regardless of which event types the server emits
      // If both are present, dedicated events (tool:start/tool:complete) control the state
      let activitySetByDedicatedEvent = false

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine) {
              // Empty line indicates end of event, reset pending event type
              pendingEventType = null
              continue
            }

            if (trimmedLine.startsWith('event: ')) {
              pendingEventType = trimmedLine.slice(7).trim()
              continue
            }

            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(6)
              if (jsonStr === '[DONE]') {
                pendingEventType = null
                continue
              }

              const eventType = pendingEventType
              pendingEventType = null

              try {
                const eventData = JSON.parse(jsonStr)

                switch (eventType) {
                  case 'message:chunk': {
                    // LLM is generating text - server sends chunks for live display
                    currentActivity.value = 'streaming_message'
                    currentToolName.value = null
                    activitySetByDedicatedEvent = false // Reset flag when LLM starts streaming

                    // Server-provided messageId is required (server generates UUID on first chunk)
                    if (!eventData.messageId) {
                      console.warn('message:chunk missing messageId, skipping')
                      break
                    }

                    // Create TEMPORARY assistant message on first chunk using SERVER-GENERATED messageId
                    // This is optimistic UI for live streaming; the authoritative message list comes in messages:complete
                    if (!currentAssistantMessageId && eventData.messageId) {
                      currentAssistantMessageId = eventData.messageId
                      currentAssistantMessageText = ''
                      messages.value.push({
                        id: eventData.messageId, // Use server-provided ID
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: '' }] as NonEmptyArray<{ type: 'text', text: string }>,
                        createdAt: new Date()
                      })
                    }
                    // Accumulate chunks and update temporary message for live display
                    currentAssistantMessageText += eventData.chunk || ''
                    if (currentAssistantMessageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      if (messageIndex >= 0 && messages.value[messageIndex]?.parts?.[0]) {
                        messages.value[messageIndex].parts[0].text = currentAssistantMessageText
                      }
                    }
                    break
                  }

                  case 'message:complete': {
                    // LLM text generation finished for current turn (intermediate signal before DB snapshot)
                    // Update final text, but authoritative message list comes in messages:complete
                    if (eventData.messageId && eventData.message) {
                      const messageIndex = messages.value.findIndex(m => m.id === eventData.messageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message?.parts?.[0]) {
                        message.parts[0].text = eventData.message
                      }
                    }
                    // Clear streaming state (tools may still be executing)
                    currentAssistantMessageId = null
                    currentAssistantMessageText = ''
                    if (currentActivity.value === 'streaming_message') {
                      currentActivity.value = null
                      activitySetByDedicatedEvent = false // Reset flag
                    }
                    break
                  }

                  case 'tool:start': {
                    // Tool execution started - dedicated event takes precedence
                    currentActivity.value = 'tool_executing'
                    currentToolName.value = eventData.toolName || null
                    activitySetByDedicatedEvent = true
                    break
                  }

                  case 'tool:complete': {
                    // Tool execution completed - dedicated event takes precedence
                    currentActivity.value = null
                    currentToolName.value = null
                    activitySetByDedicatedEvent = true
                    break
                  }

                  case 'conversation:update': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
                    }
                    if (eventData.conversationContentId !== undefined) {
                      conversationContentId.value = eventData.conversationContentId ?? null
                    }
                    break
                  }

                  case 'log:entry': {
                    const logEntry = {
                      id: eventData.id || createId(),
                      type: eventData.type || 'unknown',
                      message: eventData.message || '',
                      payload: eventData.payload ?? null,
                      createdAt: toDate(eventData.createdAt || new Date())
                    }
                    logs.value = [...logs.value, logEntry]

                    // Update activity state based on log type
                    // Only use log:entry events if dedicated tool:start/tool:complete events haven't been used
                    // This ensures consistent behavior regardless of which event types the server emits
                    const logType = logEntry.type?.toLowerCase() || ''
                    if (logType.startsWith('tool_')) {
                      if (logType === 'tool_started' && !activitySetByDedicatedEvent) {
                        // Fallback: only set activity if not already set by dedicated event
                        currentActivity.value = 'tool_executing'
                        currentToolName.value = (logEntry.payload as any)?.toolName || null
                      } else if (logType === 'tool_succeeded' || logType === 'tool_failed') {
                        // Tool completed, but might have more tools or LLM response coming
                        // Don't clear activity yet - wait for next event
                        // Note: If tool:complete was received, it already cleared activity
                      }
                    } else if (logType === 'user_message') {
                      // User message sent, LLM will start thinking
                      currentActivity.value = 'llm_thinking'
                      currentToolName.value = null
                      activitySetByDedicatedEvent = false // Reset flag for next tool cycle
                    }
                    break
                  }

                  case 'agentContext:update': {
                    agentContext.value = {
                      readySources: eventData.readySources?.map((source: any) => ({
                        ...source,
                        createdAt: toDate(source.createdAt),
                        updatedAt: toDate(source.updatedAt)
                      })) || [],
                      ingestFailures: eventData.ingestFailures || [],
                      lastAction: eventData.lastAction || null,
                      toolHistory: eventData.toolHistory?.map((tool: any) => ({
                        ...tool,
                        timestamp: toDate(tool.timestamp)
                      })) || []
                    }
                    break
                  }

                  case 'messages:complete': {
                    // AUTHORITATIVE message list from database (single source of truth)
                    // Client MUST replace its messages array with this snapshot and clear all temporary streaming state
                    if (Array.isArray(eventData.messages)) {
                      const normalizedMessages = normalizeMessages(eventData.messages)
                      // Replace all messages with server's authoritative list (sorted by createdAt)
                      messages.value = normalizedMessages.sort((a, b) =>
                        a.createdAt.getTime() - b.createdAt.getTime()
                      )
                      // Clear all temporary streaming state
                      currentAssistantMessageId = null
                      currentAssistantMessageText = ''
                    }
                    break
                  }

                  case 'logs:complete': {
                    if (Array.isArray(eventData.logs)) {
                      logs.value = normalizeLogs(eventData.logs)
                    }
                    break
                  }

                  case 'conversation:final': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
                    }
                    if (eventData.conversationContentId !== undefined) {
                      conversationContentId.value = eventData.conversationContentId ?? null
                    }
                    break
                  }

                  case 'done': {
                    // Stream completion signal from server
                    // If messages:complete was not received before this, treat as error/incomplete
                    // The finally block will clear streaming state
                    break
                  }

                  case 'error': {
                    // Server-side error during processing
                    // Error messages are also added to database and included in messages:complete
                    const errorMsg = eventData.message || eventData.error || 'An error occurred'
                    errorMessage.value = errorMsg
                    break
                  }

                  default: {
                    // Unknown event type, log for debugging
                    if (eventType) {
                      console.warn('Unknown SSE event type:', eventType, eventData)
                    }
                    break
                  }
                }
              } catch (parseError) {
                console.error('Failed to parse SSE data:', jsonStr, parseError)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
        // Always clear streaming state when stream ends (success or failure)
        // If messages:complete was received, messages are already replaced with authoritative list
        // If stream was aborted or failed, temporary messages remain until next successful turn
        currentAssistantMessageId = null
        currentAssistantMessageText = ''
      }

      // Stream completed successfully
      // If messages:complete was received, messages array was replaced with authoritative snapshot
      status.value = 'ready'
      requestStartedAt.value = null
      currentActivity.value = null
      currentToolName.value = null
      return null // Streaming doesn't return a response object
    } catch (error: any) {
      // Handle stream errors and aborts
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        // User aborted the request - clear state gracefully
        status.value = 'ready'
        requestStartedAt.value = null
        currentActivity.value = null
        currentToolName.value = null
        // Note: Temporary streaming messages may remain in UI until next successful turn
        return null
      }
      // Stream failed (network error, server error, etc.)
      status.value = 'error'
      requestStartedAt.value = null
      currentActivity.value = null
      currentToolName.value = null
      const errorMsg = error?.message || error?.data?.statusMessage || error?.data?.message || 'Something went wrong.'
      errorMessage.value = errorMsg
      // Note: If server committed any messages before error, they will be in messages:complete
      // If stream failed before messages:complete, temporary messages may remain until next turn
      return null
    } finally {
      if (activeController.value === controller) {
        activeController.value = null
      }
      if (status.value === 'ready' || status.value === 'error') {
        requestStartedAt.value = null
      }
    }
  }

  async function sendMessage(prompt: string, options?: { displayContent?: string, contentId?: string | null }) {
    const trimmed = prompt.trim()
    if (!trimmed) {
      return null
    }

    // User messages are created on the server after processing (not optimistically)
    // Assistant messages are created optimistically on first message:chunk with server-generated ID
    // Final authoritative message list (including user message) comes in messages:complete
    return await callChatEndpoint({
      message: trimmed,
      mode: mode.value,
      contentId: options?.contentId !== undefined
        ? options.contentId
        : (conversationContentId.value || undefined)
    })
  }

  function hydrateConversation(payload: {
    messages?: ChatResponse['messages']
    logs?: ChatResponse['logs']
    conversationId?: string | null
    conversationContentId?: string | null
  }) {
    if (payload.conversationId !== undefined) {
      conversationId.value = payload.conversationId
    }

    if (payload.conversationContentId !== undefined) {
      conversationContentId.value = payload.conversationContentId
    }

    if (payload.messages) {
      messages.value = normalizeMessages(payload.messages)
    }

    if (payload.logs) {
      logs.value = normalizeLogs(payload.logs)
    }
  }

  async function loadConversationForContent(contentId: string) {
    const response = await $fetch<{ workspace: Record<string, any> | null }>(`/api/content/${contentId}`)

    const workspace = response?.workspace
    if (workspace?.content?.id) {
      if (workspace.chatSession?.id && (!workspace.chatMessages || !workspace.chatLogs)) {
        try {
          // Use conversation endpoints for messages and logs
          const conversationId = workspace.chatSession.id
          const [messagesResponse, logsResponse] = await Promise.all([
            $fetch<{ messages: any[] }>(`/api/conversations/${conversationId}/messages`),
            $fetch<{ logs: any[] }>(`/api/conversations/${conversationId}/logs`)
          ])
          workspace.chatMessages = messagesResponse.messages
          workspace.chatLogs = logsResponse.logs
        } catch (error) {
          console.error('[useConversation] Failed to fetch conversation history', error)
        }
      }

      hydrateConversation({
        conversationId: workspace.chatSession?.id ?? null,
        conversationContentId: workspace.chatSession?.contentId ?? workspace.content.id,
        messages: workspace.chatMessages,
        logs: workspace.chatLogs
      })
    }

    return workspace
  }

  function stopResponse() {
    if (activeController.value) {
      activeController.value.abort()
      return true
    }
    return false
  }

  function resetConversation() {
    messages.value = []
    status.value = 'ready'
    errorMessage.value = null
    conversationId.value = null
    conversationContentId.value = null
    logs.value = []
    requestStartedAt.value = null
    agentContext.value = null
    prompt.value = ''
    currentActivity.value = null
    currentToolName.value = null
  }

  return {
    messages,
    status,
    errorMessage,
    isBusy,
    selectedContentType,
    sendMessage,
    conversationId,
    conversationContentId,
    stopResponse,
    logs,
    requestStartedAt,
    agentContext,
    hydrateConversation,
    loadConversationForContent,
    resetConversation,
    prompt,
    mode,
    currentActivity,
    currentToolName
  }
}
