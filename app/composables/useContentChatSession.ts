import type { ChatMessage } from '#shared/utils/types'
import type { Ref } from 'vue'
import { useState } from '#app'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

interface PatchSectionResponse {
  content: Record<string, any>
  version: Record<string, any>
  markdown: string
  section?: {
    id: string
    title: string
    index: number
  }
}

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const timestamp = Date.now()

  let randomHex = ''

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(2)
    crypto.getRandomValues(buffer)
    randomHex = Array.from(buffer).map(part => part.toString(16).padStart(8, '0')).join('')
  } else {
    randomHex = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)
  }

  return `${timestamp}-${randomHex}`
}

export function useContentChatSession(contentId: string | Ref<string>) {
  const id = typeof contentId === 'string' ? contentId : contentId.value
  const stateKey = (suffix: string) => `content-chat-${id}-${suffix}`

  const messages = useState<ChatMessage[]>(stateKey('messages'), () => ([
    {
      id: createId(),
      role: 'assistant',
      content: 'Choose a section and describe how you want it updated. I will rewrite that section and save a new version.',
      createdAt: new Date()
    }
  ]))
  const status = useState<ChatStatus>(stateKey('status'), () => 'ready')
  const errorMessage = useState<string | null>(stateKey('error'), () => null)

  async function sendMessage(prompt: string, options?: { sectionId?: string | null, sectionTitle?: string | null }) {
    const trimmed = prompt.trim()
    if (!trimmed) {
      return
    }

    const sectionId = options?.sectionId

    if (!sectionId) {
      status.value = 'error'
      errorMessage.value = 'Select a section before sending instructions.'
      return
    }

    status.value = 'submitted'
    errorMessage.value = null

    messages.value.push({
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date()
    })

    try {
      const response = await $fetch<PatchSectionResponse>(`/api/content/${id}/sections/${sectionId}`, {
        method: 'POST',
        body: {
          instructions: trimmed
        }
      })

      const sectionLabel = response.section?.title || options?.sectionTitle || 'selected section'
      messages.value.push({
        id: createId(),
        role: 'assistant',
        content: `Updated “${sectionLabel}.” Refreshing the draft now.`,
        createdAt: new Date()
      })

      status.value = 'ready'
    } catch (error: any) {
      console.error('Failed to patch section', error)
      status.value = 'error'
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Failed to update that section.'
    }
  }

  function resetSession() {
    messages.value = [{
      id: createId(),
      role: 'assistant',
      content: 'Choose a section and describe how you want it updated. I will rewrite that section and save a new version.',
      createdAt: new Date()
    }]
    status.value = 'ready'
    errorMessage.value = null
  }

  return {
    messages,
    status,
    errorMessage,
    sendMessage,
    resetSession
  }
}
