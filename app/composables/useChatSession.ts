import type { ContentType } from '#shared/constants/contentTypes'
import type {
  ChatActionSuggestion,
  ChatGenerationResult,
  ChatLogEntry,
  ChatMessage,
  ChatSourceSnapshot,
  NonEmptyArray
} from '#shared/utils/types'
import { useState } from '#app'
import { DEFAULT_CONTENT_TYPE } from '#shared/constants/contentTypes'
import { computed } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface ChatResponse {
  assistantMessage?: string
  sources?: ChatSourceSnapshot[]
  generation?: ChatGenerationResult | null
  sessionId?: string | null
  sessionContentId?: string | null
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

interface CreateContentFromConversationPayload {
  title: string
  contentType: ContentType
  messageIds?: string[]
}

interface CreateContentFromConversationResponse {
  content: Record<string, any>
  version: Record<string, any>
}

export function useChatSession() {
  const messages = useState<ChatMessage[]>('chat/messages', () => [])
  const status = useState<ChatStatus>('chat/status', () => 'ready')
  const actions = useState<ChatActionSuggestion[]>('chat/actions', () => [])
  const sources = useState<ChatSourceSnapshot[]>('chat/sources', () => [])
  const generation = useState<ChatGenerationResult | null>('chat/generation', () => null)
  const errorMessage = useState<string | null>('chat/error', () => null)
  const selectedContentType = useState<ContentType>('chat/content-type', () => DEFAULT_CONTENT_TYPE)
  const activeSourceId = useState<string | null>('chat/active-source-id', () => null)
  const sessionId = useState<string | null>('chat/session-id', () => null)
  const sessionContentId = useState<string | null>('chat/session-content-id', () => null)
  const logs = useState<ChatLogEntry[]>('chat/logs', () => [])

  const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')

  function withSelectedContentType(body: Record<string, any> = {}) {
    const contentType = selectedContentType.value
    const nextBody: Record<string, any> = {
      ...body,
      contentType
    }
    if (nextBody.action && typeof nextBody.action === 'object' && nextBody.action !== null) {
      nextBody.action = {
        ...nextBody.action,
        contentType: nextBody.action.contentType || contentType
      }
    }
    return nextBody
  }

  async function callChatEndpoint(body: Record<string, any>) {
    status.value = 'submitted'
    errorMessage.value = null

    try {
      status.value = 'streaming'
      const response = await $fetch<ChatResponse>('/api/chat', {
        method: 'POST',
        body: withSelectedContentType(body)
      })

      sessionId.value = response.sessionId ?? sessionId.value
      sessionContentId.value = response.sessionContentId ?? sessionContentId.value ?? null

      const normalizedMessages = normalizeMessages(response.messages)

      if (normalizedMessages.length > 0) {
        messages.value = normalizedMessages
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

      // Actions removed - sources are now described in LLM messages
      sources.value = response.sources ?? []
      const firstSourceId = sources.value[0]?.id ?? null
      activeSourceId.value = firstSourceId
      generation.value = response.generation ?? null
      logs.value = normalizeLogs(response.logs)
      status.value = 'ready'
      return response
    } catch (error: any) {
      status.value = 'error'
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
    }
  }

  async function sendMessage(prompt: string, options?: { displayContent?: string, contentId?: string | null, action?: Record<string, any> }) {
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
        : (sessionContentId.value || undefined),
      action: options?.action
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
    const response = await $fetch<{ workspace: Record<string, any> | null }>(`/api/chat/workspace/${contentId}`)

    const workspace = response?.workspace
    if (workspace?.content?.id) {
      if (workspace.chatSession?.id && (!workspace.chatMessages || !workspace.chatLogs)) {
        try {
          const [messagesResponse, logsResponse] = await Promise.all([
            $fetch<{ messages: any[] }>(`/api/chat/workspace/${workspace.content.id}/messages`),
            $fetch<{ logs: any[] }>(`/api/chat/workspace/${workspace.content.id}/logs`)
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

  async function generateFromSource(action: ChatActionSuggestion) {
    if (!action.sourceContentId) {
      errorMessage.value = 'Missing source reference for this action.'
      status.value = 'error'
      return
    }

    const source = sources.value.find(sourceItem => sourceItem.id === action.sourceContentId)

    if (!source) {
      status.value = 'error'
      errorMessage.value = 'Source details not available yet. Try again after a refresh.'
      return
    }

    if (source.ingestStatus !== 'ingested') {
      status.value = 'error'
      errorMessage.value = 'Still grabbing the transcript for that source. Try again in a moment.'
      return
    }

    status.value = 'streaming'
    errorMessage.value = null
    activeSourceId.value = action.sourceContentId

    try {
      const response = await $fetch<ChatGenerationResult>('/api/content/generate', {
        method: 'POST',
        body: {
          sourceContentId: action.sourceContentId,
          contentType: selectedContentType.value
        }
      })

      generation.value = response

      const title = (response as any)?.content?.title
      const messageContent = title
        ? `Draft "${title}" created. Open Content to review or publish it.`
        : 'Draft created from that source. Head to Content to review it.'

      messages.value.push({
        id: createId(),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: messageContent }] as NonEmptyArray<{ type: 'text', text: string }>,
        createdAt: new Date()
      })

      status.value = 'ready'
    } catch (error: any) {
      status.value = 'error'
      const errorMsg = error?.data?.statusMessage || error?.message || 'Failed to generate content.'
      errorMessage.value = errorMsg

      // Also add error as a chat message
      messages.value.push({
        id: createId(),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }] as NonEmptyArray<{ type: 'text', text: string }>,
        createdAt: new Date()
      })
    }
  }

  async function executeAction(action: ChatActionSuggestion) {
    if (action.type === 'suggest_generate_from_source') {
      await generateFromSource(action)
      return
    }

    await callChatEndpoint({
      message: '',
      action
    })
  }

  async function createContentFromConversation(payload: CreateContentFromConversationPayload) {
    if (!sessionId.value) {
      throw new Error('Start a conversation before creating content.')
    }

    const response = await $fetch<CreateContentFromConversationResponse>(`/api/chat/${sessionId.value}/create-content`, {
      method: 'POST',
      body: {
        ...payload,
        messageIds: Array.isArray(payload.messageIds) ? payload.messageIds : undefined
      }
    })

    if (response?.content?.id) {
      sessionContentId.value = response.content.id
    }

    return response
  }

  function resetSession() {
    messages.value = []
    status.value = 'ready'
    actions.value = []
    sources.value = []
    generation.value = null
    errorMessage.value = null
    activeSourceId.value = null
    sessionId.value = null
    sessionContentId.value = null
    logs.value = []
  }

  return {
    messages,
    status,
    actions,
    sources,
    generation,
    errorMessage,
    isBusy,
    activeSourceId,
    selectedContentType,
    sendMessage,
    executeAction,
    sessionId,
    sessionContentId,
    createContentFromConversation,
    logs,
    hydrateSession,
    loadSessionForContent,
    resetSession
  }
}
