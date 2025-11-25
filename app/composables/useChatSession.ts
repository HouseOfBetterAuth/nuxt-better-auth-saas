import type { ContentType } from '#shared/constants/contentTypes'
import type {
  ChatActionSuggestion,
  ChatGenerationResult,
  ChatMessage,
  ChatSourceSnapshot
} from '#shared/utils/types'
import { useState } from '#app'
import { DEFAULT_CONTENT_TYPE } from '#shared/constants/contentTypes'
import { computed } from 'vue'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error' | 'idle'

interface ChatResponse {
  assistantMessage?: string
  actions?: ChatActionSuggestion[]
  sources?: ChatSourceSnapshot[]
  generation?: ChatGenerationResult | null
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

export function useChatSession() {
  const messages = useState<ChatMessage[]>('chat/messages', () => [{
    id: createId(),
    role: 'assistant',
    content: 'Hi! Share a link or describe what you want to write and I can prep a draft.',
    createdAt: new Date()
  }])
  const status = useState<ChatStatus>('chat/status', () => 'ready')
  const actions = useState<ChatActionSuggestion[]>('chat/actions', () => [])
  const sources = useState<ChatSourceSnapshot[]>('chat/sources', () => [])
  const generation = useState<ChatGenerationResult | null>('chat/generation', () => null)
  const errorMessage = useState<string | null>('chat/error', () => null)
  const selectedContentType = useState<ContentType>('chat/content-type', () => DEFAULT_CONTENT_TYPE)

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
      const response = await $fetch<ChatResponse>('/api/chat', {
        method: 'POST',
        body: withSelectedContentType(body)
      })

      if (response.assistantMessage) {
        messages.value.push({
          id: createId(),
          role: 'assistant',
          content: response.assistantMessage,
          createdAt: new Date()
        })
      }

      actions.value = response.actions ?? []
      sources.value = response.sources ?? []
      generation.value = response.generation ?? null
      status.value = 'ready'
    } catch (error: any) {
      status.value = 'error'
      errorMessage.value = error?.data?.message || error?.message || 'Something went wrong.'
    }
  }

  async function sendMessage(prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) {
      return
    }

    messages.value.push({
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date()
    })

    await callChatEndpoint({ message: trimmed })
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

    try {
      const response = await $fetch<ChatGenerationResult>('/api/content/generate', {
        method: 'POST',
        body: {
          sourceContentId: action.sourceContentId,
          contentType: selectedContentType.value
        }
      })

      generation.value = response
      actions.value = []

      const title = (response as any)?.content?.title
      const messageContent = title
        ? `Draft "${title}" created. Open Content to review or publish it.`
        : 'Draft created from that source. Head to Content to review it.'

      messages.value.push({
        id: createId(),
        role: 'assistant',
        content: messageContent,
        createdAt: new Date()
      })

      status.value = 'ready'
    } catch (error: any) {
      status.value = 'error'
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Failed to generate content.'
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

  return {
    messages,
    status,
    actions,
    sources,
    generation,
    errorMessage,
    isBusy,
    selectedContentType,
    sendMessage,
    executeAction
  }
}
