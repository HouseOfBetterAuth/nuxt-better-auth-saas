import type {
  ChatMessage,
  NonEmptyArray
} from '#shared/utils/types'
import { useState } from '#app'
import { computed } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface ChatResponse {
  assistantMessage?: string
  conversationId?: string | null
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

export function useConversation() {
  const messages = useState<ChatMessage[]>('chat/messages', () => [])
  const status = useState<ChatStatus>('chat/status', () => 'ready')
  const errorMessage = useState<string | null>('chat/error', () => null)
  const conversationId = useState<string | null>('chat/conversation-id', () => null)
  const requestStartedAt = useState<Date | null>('chat/request-started-at', () => null)
  const activeController = useState<AbortController | null>('chat/active-controller', () => null)
  const prompt = useState<string>('chat/prompt', () => '')
  const mode = useState<'chat' | 'agent'>('chat/mode', () => 'chat')
  // Simplified activity tracking - just track if we're thinking (tools running) or streaming (LLM generating)
  const currentActivity = useState<'thinking' | 'streaming' | null>('chat/current-activity', () => null)
  const currentToolName = useState<string | null>('chat/current-tool-name', () => null)

  const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')

  async function callChatEndpoint(body: Record<string, any>) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    requestStartedAt.value = new Date()
    status.value = 'submitted'
    errorMessage.value = null
    currentActivity.value = 'thinking' // Initial state - LLM is thinking about the request
    currentToolName.value = null

    if (activeController.value) {
      activeController.value.abort()
    }
    activeController.value = controller

    try {
      status.value = 'streaming'
      const payload = { ...body }
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
                    currentActivity.value = 'streaming'
                    currentToolName.value = null

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
                    if (currentActivity.value === 'streaming') {
                      currentActivity.value = null
                    }
                    break
                  }

                  case 'tool:start': {
                    // Tool execution started
                    currentActivity.value = 'thinking'
                    currentToolName.value = eventData.toolName || null
                    break
                  }

                  case 'tool:complete': {
                    // Tool execution completed - may have more tools or LLM response coming
                    // Don't clear activity yet, wait for next event (message:chunk or done)
                    currentToolName.value = null
                    break
                  }

                  case 'conversation:update': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
                    }
                    break
                  }

                  case 'log:entry': {
                    // Logs are for server-side observability only, not used in UI
                    // Activity state is managed by tool:start/tool:complete and message:chunk events
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
                    // Logs are for server-side observability only, not used in UI
                    break
                  }

                  case 'agentContext:update': {
                    // Agent context is for server-side observability only, not used in UI
                    break
                  }

                  case 'conversation:final': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
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
      contentId: options?.contentId
    })
  }

  function hydrateConversation(payload: {
    messages?: ChatResponse['messages']
    conversationId?: string | null
  }) {
    if (payload.conversationId !== undefined) {
      conversationId.value = payload.conversationId
    }

    if (payload.messages) {
      messages.value = normalizeMessages(payload.messages)
    }
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
    requestStartedAt.value = null
    prompt.value = ''
    currentActivity.value = null
    currentToolName.value = null
  }

  return {
    messages,
    status,
    errorMessage,
    isBusy,
    sendMessage,
    conversationId,
    stopResponse,
    requestStartedAt,
    hydrateConversation,
    resetConversation,
    prompt,
    mode,
    currentActivity,
    currentToolName
  }
}
