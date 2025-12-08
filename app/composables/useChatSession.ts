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
  sessionId?: string | null
  sessionContentId?: string | null
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

export function useChatSession() {
  const messages = useState<ChatMessage[]>('chat/messages', () => [])
  const status = useState<ChatStatus>('chat/status', () => 'ready')
  const errorMessage = useState<string | null>('chat/error', () => null)
  const selectedContentType = useState<ContentType>('chat/content-type', () => DEFAULT_CONTENT_TYPE)
  const sessionId = useState<string | null>('chat/session-id', () => null)
  const sessionContentId = useState<string | null>('chat/session-content-id', () => null)
  const logs = useState<ChatLogEntry[]>('chat/logs', () => [])
  const requestStartedAt = useState<Date | null>('chat/request-started-at', () => null)
  const activeController = useState<AbortController | null>('chat/active-controller', () => null)
  const agentContext = useState<AgentContext | null>('chat/agent-context', () => null)
  const prompt = useState<string>('chat/prompt', () => '')
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
      if (sessionId.value) {
        payload.sessionId = sessionId.value
      }

      // Use streaming by default
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

      // Remove the user message we just added (server will send it back)
      const lastUserMessage = messages.value[messages.value.length - 1]
      if (lastUserMessage?.role === 'user') {
        messages.value = messages.value.slice(0, -1)
      }

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
                    // LLM is generating text
                    currentActivity.value = 'streaming_message'
                    currentToolName.value = null

                    if (!currentAssistantMessageId) {
                      currentAssistantMessageId = eventData.messageId || createId()
                      currentAssistantMessageText = ''
                      // Create new assistant message
                      if (currentAssistantMessageId) {
                        messages.value.push({
                          id: currentAssistantMessageId,
                          role: 'assistant' as const,
                          parts: [{ type: 'text' as const, text: '' }] as NonEmptyArray<{ type: 'text', text: string }>,
                          createdAt: new Date()
                        })
                      }
                    }
                    currentAssistantMessageText += eventData.chunk || ''
                    // Update the message
                    if (currentAssistantMessageId) {
                      const messageIndex = messages.value.findIndex(m => m.id === currentAssistantMessageId)
                      if (messageIndex >= 0 && messages.value[messageIndex]?.parts?.[0]) {
                        messages.value[messageIndex].parts[0].text = currentAssistantMessageText
                      }
                    }
                    break
                  }

                  case 'message:complete': {
                    if (eventData.messageId && eventData.message) {
                      const messageIndex = messages.value.findIndex(m => m.id === eventData.messageId)
                      const message = messageIndex >= 0 ? messages.value[messageIndex] : null
                      if (message?.parts?.[0]) {
                        message.parts[0].text = eventData.message
                      }
                    }
                    currentAssistantMessageId = null
                    currentAssistantMessageText = ''
                    // Message complete, but might still be processing tools
                    if (currentActivity.value === 'streaming_message') {
                      currentActivity.value = null
                    }
                    break
                  }

                  case 'tool:start': {
                    // Tool execution started
                    currentActivity.value = 'tool_executing'
                    currentToolName.value = eventData.toolName || null
                    break
                  }

                  case 'tool:complete': {
                    // Tool execution completed
                    currentActivity.value = null
                    currentToolName.value = null
                    break
                  }

                  case 'session:update': {
                    if (eventData.sessionId) {
                      sessionId.value = eventData.sessionId ?? sessionId.value
                    }
                    if (eventData.sessionContentId !== undefined) {
                      sessionContentId.value = eventData.sessionContentId ?? null
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
                    const logType = logEntry.type?.toLowerCase() || ''
                    if (logType.startsWith('tool_')) {
                      if (logType === 'tool_started') {
                        currentActivity.value = 'tool_executing'
                        currentToolName.value = (logEntry.payload as any)?.toolName || null
                      } else if (logType === 'tool_succeeded' || logType === 'tool_failed') {
                        // Tool completed, but might have more tools or LLM response coming
                        // Don't clear activity yet - wait for next event
                      }
                    } else if (logType === 'user_message') {
                      // User message sent, LLM will start thinking
                      currentActivity.value = 'llm_thinking'
                      currentToolName.value = null
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
                    if (Array.isArray(eventData.messages)) {
                      const normalizedMessages = normalizeMessages(eventData.messages)
                      const existingMessageMap = new Map(messages.value.map(msg => [msg.id, msg]))
                      for (const newMessage of normalizedMessages) {
                        existingMessageMap.set(newMessage.id, newMessage)
                      }
                      messages.value = Array.from(existingMessageMap.values()).sort((a, b) =>
                        a.createdAt.getTime() - b.createdAt.getTime()
                      )
                    }
                    break
                  }

                  case 'logs:complete': {
                    if (Array.isArray(eventData.logs)) {
                      logs.value = normalizeLogs(eventData.logs)
                    }
                    break
                  }

                  case 'session:final': {
                    if (eventData.sessionId) {
                      sessionId.value = eventData.sessionId ?? sessionId.value
                    }
                    if (eventData.sessionContentId !== undefined) {
                      sessionContentId.value = eventData.sessionContentId ?? null
                    }
                    break
                  }

                  case 'done': {
                    // Stream complete
                    break
                  }

                  case 'error': {
                    const errorMsg = eventData.message || eventData.error || 'An error occurred'
                    errorMessage.value = errorMsg
                    messages.value.push({
                      id: createId(),
                      role: 'assistant' as const,
                      parts: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }] as NonEmptyArray<{ type: 'text', text: string }>,
                      createdAt: new Date()
                    })
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
      }

      status.value = 'ready'
      requestStartedAt.value = null
      currentActivity.value = null
      currentToolName.value = null
      return null // Streaming doesn't return a response object
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

      // Also add error as a chat message so user can see it
      messages.value.push({
        id: createId(),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }] as NonEmptyArray<{ type: 'text', text: string }>,
        createdAt: new Date()
      })

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

    messages.value.push({
      id: createId(),
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: options?.displayContent?.trim() || trimmed }] as NonEmptyArray<{ type: 'text', text: string }>,
      createdAt: new Date()
    })

    return await callChatEndpoint({
      message: trimmed,
      contentId: options?.contentId !== undefined
        ? options.contentId
        : (sessionContentId.value || undefined)
    })
  }

  function hydrateSession(payload: {
    messages?: ChatResponse['messages']
    logs?: ChatResponse['logs']
    sessionId?: string | null
    sessionContentId?: string | null
  }) {
    if (payload.sessionId !== undefined) {
      sessionId.value = payload.sessionId
    }

    if (payload.sessionContentId !== undefined) {
      sessionContentId.value = payload.sessionContentId
    }

    if (payload.messages) {
      messages.value = normalizeMessages(payload.messages)
    }

    if (payload.logs) {
      logs.value = normalizeLogs(payload.logs)
    }
  }

  async function loadSessionForContent(contentId: string) {
    const response = await $fetch<{ workspace: Record<string, any> | null }>(`/api/drafts/${contentId}`)

    const workspace = response?.workspace
    if (workspace?.content?.id) {
      if (workspace.chatSession?.id && (!workspace.chatMessages || !workspace.chatLogs)) {
        try {
          const [messagesResponse, logsResponse] = await Promise.all([
            $fetch<{ messages: any[] }>(`/api/drafts/${workspace.content.id}/messages`),
            $fetch<{ logs: any[] }>(`/api/drafts/${workspace.content.id}/logs`)
          ])
          workspace.chatMessages = messagesResponse.messages
          workspace.chatLogs = logsResponse.logs
        } catch (error) {
          console.error('[useChatSession] Failed to fetch chat history', error)
        }
      }

      hydrateSession({
        sessionId: workspace.chatSession?.id ?? null,
        sessionContentId: workspace.chatSession?.contentId ?? workspace.content.id,
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

  function resetSession() {
    messages.value = []
    status.value = 'ready'
    errorMessage.value = null
    sessionId.value = null
    sessionContentId.value = null
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
    sessionId,
    sessionContentId,
    stopResponse,
    logs,
    requestStartedAt,
    agentContext,
    hydrateSession,
    loadSessionForContent,
    resetSession,
    prompt,
    currentActivity,
    currentToolName
  }
}
