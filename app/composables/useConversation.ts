import type {
  ChatMessage,
  MessagePart,
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
  const currentActivity = useState<'thinking' | 'streaming' | null>('chat/current-activity', () => null)
  const currentToolName = useState<string | null>('chat/current-tool-name', () => null)

  // Track active tool calls by unique toolCallId (supports concurrent calls to same tool)
  // Maps toolCallId -> { messageId, partIndex }
  const activeToolCalls = useState<Map<string, { messageId: string, partIndex: number }>>('chat/active-tool-calls', () => new Map())

  // Client-side message cache for instant navigation
  // Maps conversationId -> { messages, timestamp }
  const messageCache = useState<Map<string, { messages: ChatMessage[], timestamp: number }>>('chat/message-cache', () => new Map())
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')

  const resetConversation = () => {
    messages.value = []
    conversationId.value = null
    status.value = 'ready'
    errorMessage.value = null
    requestStartedAt.value = null
    currentActivity.value = null
    currentToolName.value = null
    activeToolCalls.value.clear()
  }

  const hydrateConversation = ({ conversationId: id, messages: msgs }: { conversationId: string, messages: ChatMessage[] }, options?: { skipCache?: boolean }) => {
    conversationId.value = id
    messages.value = msgs
    status.value = 'ready'
    errorMessage.value = null
    requestStartedAt.value = null
    currentActivity.value = null
    currentToolName.value = null
    activeToolCalls.value.clear()

    // Cache messages for instant future navigation (unless explicitly skipped)
    if (!options?.skipCache) {
      messageCache.value.set(id, {
        messages: msgs,
        timestamp: Date.now()
      })
    }
  }

  // Get cached messages if available and fresh
  const getCachedMessages = (id: string): ChatMessage[] | null => {
    const cached = messageCache.value.get(id)
    if (!cached)
      return null

    const age = Date.now() - cached.timestamp
    if (age > CACHE_TTL_MS) {
      // Cache expired, remove it
      messageCache.value.delete(id)
      return null
    }

    return cached.messages
  }

  async function callChatEndpoint(body: Record<string, any>) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    requestStartedAt.value = new Date()
    status.value = 'submitted'
    errorMessage.value = null
    currentActivity.value = 'thinking'
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
                    currentActivity.value = 'streaming'
                    currentToolName.value = null

                    if (!eventData.messageId) {
                      console.warn('message:chunk missing messageId, skipping')
                      break
                    }

                    const serverMessageId = eventData.messageId

                    // Reconcile temp ID with server ID
                    if (currentAssistantMessageId && currentAssistantMessageId !== serverMessageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message) {
                        message.id = serverMessageId
                        currentAssistantMessageId = serverMessageId
                      }
                    }

                    // Create assistant message on first chunk
                    if (!currentAssistantMessageId && serverMessageId) {
                      currentAssistantMessageId = serverMessageId
                      currentAssistantMessageText = ''
                      messages.value.push({
                        id: serverMessageId,
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: '' }] as NonEmptyArray<MessagePart>,
                        createdAt: new Date()
                      })
                    }

                    // Update text content
                    currentAssistantMessageText += eventData.chunk || ''
                    if (currentAssistantMessageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message) {
                        const textPartIndex = message.parts.findIndex(p => p.type === 'text')
                        const textPart = textPartIndex >= 0 ? message.parts[textPartIndex] : null
                        if (textPart && textPart.type === 'text') {
                          textPart.text = currentAssistantMessageText
                        } else {
                          message.parts.push({ type: 'text', text: currentAssistantMessageText })
                        }
                      }
                    }
                    break
                  }

                  case 'message:complete': {
                    if (eventData.messageId && eventData.message) {
                      const messageIndex = messages.value.findIndex(m => m.id === eventData.messageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message) {
                        const textPartIndex = message.parts.findIndex(p => p.type === 'text')
                        const textPart = textPartIndex >= 0 ? message.parts[textPartIndex] : null
                        if (textPart && textPart.type === 'text') {
                          textPart.text = eventData.message
                        }
                      }
                    }
                    currentAssistantMessageId = null
                    currentAssistantMessageText = ''
                    if (currentActivity.value === 'streaming') {
                      currentActivity.value = null
                    }
                    break
                  }

                  case 'tool:preparing': {
                    currentActivity.value = 'thinking'
                    currentToolName.value = eventData.toolName || null

                    // Server MUST provide toolCallId for unique tracking
                    if (!eventData.toolCallId) {
                      console.error('tool:preparing missing toolCallId, cannot track concurrent tools')
                      break
                    }

                    // Ensure we have an assistant message
                    if (!currentAssistantMessageId) {
                      const messageId = eventData.messageId || createId()
                      currentAssistantMessageId = messageId
                      messages.value.push({
                        id: messageId,
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: '' }] as NonEmptyArray<MessagePart>,
                        createdAt: new Date()
                      })
                    } else if (eventData.messageId && currentAssistantMessageId !== eventData.messageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message) {
                        message.id = eventData.messageId
                        currentAssistantMessageId = eventData.messageId
                      }
                    }

                    const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                    const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                    if (message && eventData.toolName) {
                      // Check if tool part already exists (upgrade from preparing to running)
                      const existingToolPartIndex = message.parts.findIndex(
                        p => p.type === 'tool_call' && p.toolCallId === eventData.toolCallId
                      )

                      if (existingToolPartIndex >= 0) {
                        // Already exists, skip (will be upgraded to 'running' by tool:start)
                        break
                      }

                      // Add tool_call part with 'preparing' status
                      const toolPart: MessagePart = {
                        type: 'tool_call',
                        toolCallId: eventData.toolCallId,
                        toolName: eventData.toolName,
                        status: 'preparing',
                        timestamp: new Date().toISOString()
                      }
                      message.parts.push(toolPart)

                      // Track by toolCallId (not toolName!)
                      activeToolCalls.value.set(eventData.toolCallId, {
                        messageId: message.id,
                        partIndex: message.parts.length - 1
                      })
                    }
                    break
                  }

                  case 'tool:start': {
                    currentActivity.value = 'thinking'
                    currentToolName.value = eventData.toolName || null

                    // Server MUST provide toolCallId for unique tracking
                    if (!eventData.toolCallId) {
                      console.error('tool:start missing toolCallId, cannot track concurrent tools')
                      break
                    }

                    // Ensure we have an assistant message
                    if (!currentAssistantMessageId) {
                      const messageId = eventData.messageId || createId()
                      currentAssistantMessageId = messageId
                      messages.value.push({
                        id: messageId,
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: '' }] as NonEmptyArray<MessagePart>,
                        createdAt: new Date()
                      })
                    } else if (eventData.messageId && currentAssistantMessageId !== eventData.messageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message) {
                        message.id = eventData.messageId
                        currentAssistantMessageId = eventData.messageId
                      }
                    }

                    const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                    const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                    if (message && eventData.toolName) {
                      // Check if tool part already exists (from tool:preparing)
                      const existingToolPartIndex = message.parts.findIndex(
                        p => p.type === 'tool_call' && p.toolCallId === eventData.toolCallId
                      )

                      if (existingToolPartIndex >= 0) {
                        // Upgrade from 'preparing' to 'running'
                        const toolPart = message.parts[existingToolPartIndex]
                        if (toolPart.type === 'tool_call') {
                          toolPart.status = 'running'
                          toolPart.args = eventData.args
                        }
                        // Update tracking
                        activeToolCalls.value.set(eventData.toolCallId, {
                          messageId: message.id,
                          partIndex: existingToolPartIndex
                        })
                      } else {
                        // Add new tool_call part with 'running' status
                        const toolPart: MessagePart = {
                          type: 'tool_call',
                          toolCallId: eventData.toolCallId,
                          toolName: eventData.toolName,
                          status: 'running',
                          args: eventData.args,
                          timestamp: new Date().toISOString()
                        }
                        message.parts.push(toolPart)

                        // Track by toolCallId (not toolName!)
                        activeToolCalls.value.set(eventData.toolCallId, {
                          messageId: message.id,
                          partIndex: message.parts.length - 1
                        })
                      }
                    }
                    break
                  }

                  case 'tool:complete': {
                    currentToolName.value = null

                    // Server MUST provide toolCallId to identify which call completed
                    if (!eventData.toolCallId) {
                      console.error('tool:complete missing toolCallId, cannot update correct tool')
                      break
                    }

                    const toolCallInfo = activeToolCalls.value.get(eventData.toolCallId)
                    if (toolCallInfo) {
                      const messageIndex = messages.value.findIndex(m => m.id === toolCallInfo.messageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null

                      if (message) {
                        const toolPart = message.parts[toolCallInfo.partIndex]
                        if (toolPart && toolPart.type === 'tool_call') {
                          toolPart.status = eventData.success ? 'success' : 'error'
                          toolPart.result = eventData.result
                          toolPart.error = eventData.error
                        }
                      }

                      // Remove from active tracking
                      activeToolCalls.value.delete(eventData.toolCallId)
                    }
                    break
                  }

                  case 'tool:progress': {
                    // Update progress message for long-running tools
                    if (!eventData.toolCallId) {
                      console.error('tool:progress missing toolCallId')
                      break
                    }

                    const toolCallInfo = activeToolCalls.value.get(eventData.toolCallId)
                    if (toolCallInfo) {
                      const messageIndex = messages.value.findIndex(m => m.id === toolCallInfo.messageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null

                      if (message) {
                        const toolPart = message.parts[toolCallInfo.partIndex]
                        if (toolPart && toolPart.type === 'tool_call') {
                          // Add progress message to tool part
                          toolPart.progressMessage = eventData.message
                        }
                      }
                    }
                    break
                  }

                  case 'conversation:update': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
                    }
                    break
                  }

                  case 'log:entry': {
                    break
                  }

                  case 'messages:complete': {
                    if (Array.isArray(eventData.messages)) {
                      const normalizedMessages = normalizeMessages(eventData.messages)
                      messages.value = normalizedMessages.sort((a, b) =>
                        a.createdAt.getTime() - b.createdAt.getTime()
                      )
                      currentAssistantMessageId = null
                      currentAssistantMessageText = ''
                    }
                    break
                  }

                  case 'logs:complete': {
                    break
                  }

                  case 'agentContext:update': {
                    break
                  }

                  case 'conversation:final': {
                    if (eventData.conversationId) {
                      conversationId.value = eventData.conversationId ?? conversationId.value
                    }
                    break
                  }

                  case 'done': {
                    break
                  }

                  case 'error': {
                    const errorMsg = eventData.message || eventData.error || 'An error occurred'
                    errorMessage.value = errorMsg
                    break
                  }

                  default: {
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
        currentAssistantMessageId = null
        currentAssistantMessageText = ''
        activeToolCalls.value.clear()
      }

      status.value = 'ready'
      requestStartedAt.value = null
      currentActivity.value = null
      currentToolName.value = null
      return null
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        status.value = 'ready'
        requestStartedAt.value = null
        currentActivity.value = null
        currentToolName.value = null
        return null
      }
      status.value = 'error'
      requestStartedAt.value = null
      currentActivity.value = null
      currentToolName.value = null
      const errorMsg = error?.message || error?.data?.statusMessage || error?.data?.message || 'Something went wrong.'
      errorMessage.value = errorMsg
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

    return await callChatEndpoint({
      message: trimmed,
      mode: mode.value,
      contentId: options?.contentId
    })
  }

  function stopResponse() {
    if (activeController.value) {
      activeController.value.abort()
      return true
    }
    return false
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
    getCachedMessages,
    prompt,
    mode,
    currentActivity,
    currentToolName
  }
}
