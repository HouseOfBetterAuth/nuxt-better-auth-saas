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

      const response = await $fetch<ChatResponse>('/api/chat', {
        method: 'POST',
        body: payload,
        signal: controller?.signal
      })

      sessionId.value = response.sessionId ?? sessionId.value
      sessionContentId.value = response.sessionContentId ?? sessionContentId.value ?? null

      const normalizedMessages = normalizeMessages(response.messages)

      if (normalizedMessages.length > 0) {
        const serverHasUserMessage = normalizedMessages.some(message => message.role === 'user')

        if (serverHasUserMessage) {
          const lastMessage = messages.value[messages.value.length - 1]
          if (lastMessage?.role === 'user') {
            messages.value = messages.value.slice(0, -1)
          }
        }

        // Merge new messages with existing ones
        // Create a map of existing messages by ID for quick lookup
        const existingMessageMap = new Map(messages.value.map(msg => [msg.id, msg]))

        // Add or update messages from the response
        for (const newMessage of normalizedMessages) {
          existingMessageMap.set(newMessage.id, newMessage)
        }

        // Convert back to array and sort by createdAt
        messages.value = Array.from(existingMessageMap.values()).sort((a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime()
        )
      } else if (response.assistantMessage) {
        messages.value = [
          ...messages.value,
          {
            id: createId(),
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: response.assistantMessage }] as NonEmptyArray<{ type: 'text', text: string }>,
            createdAt: new Date()
          }
        ]
      }

      logs.value = normalizeLogs(response.logs)

      // Update agentContext if provided
      if (response.agentContext) {
        agentContext.value = {
          readySources: response.agentContext.readySources?.map(source => ({
            ...source,
            createdAt: toDate(source.createdAt),
            updatedAt: toDate(source.updatedAt)
          })),
          ingestFailures: response.agentContext.ingestFailures || [],
          lastAction: response.agentContext.lastAction || null,
          toolHistory: response.agentContext.toolHistory?.map(tool => ({
            ...tool,
            timestamp: toDate(tool.timestamp)
          })) || []
        }
      }

      status.value = 'ready'
      requestStartedAt.value = null
      return response
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        status.value = 'ready'
        requestStartedAt.value = null
        return null
      }
      status.value = 'error'
      requestStartedAt.value = null
      const errorMsg = error?.data?.statusMessage || error?.data?.message || error?.message || 'Something went wrong.'
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
    resetSession
  }
}
