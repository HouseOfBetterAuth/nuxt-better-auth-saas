import type { ChatMessage } from '#shared/utils/types'
import type { Ref } from 'vue'
import { useState } from '#app'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

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
      content: 'This is your working draft. Tell me what to change and I will update it.',
      createdAt: new Date()
    }
  ]))
  const status = useState<ChatStatus>(stateKey('status'), () => 'ready')
  const errorMessage = useState<string | null>(stateKey('error'), () => null)

  async function sendMessage(prompt: string) {
    try {
      const trimmed = prompt.trim()
      if (!trimmed) {
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

      await new Promise(resolve => setTimeout(resolve, 500))

      messages.value.push({
        id: createId(),
        role: 'assistant',
        content: `(Mock) Noted. I will apply "${trimmed}" to this draft.`,
        createdAt: new Date()
      })
    } catch (error: any) {
      console.error('Failed to send content chat message', error)
      errorMessage.value = error?.message || 'Something went wrong while sending your message.'
      status.value = 'error'
    } finally {
      if (status.value !== 'error') {
        status.value = 'ready'
      }
    }
  }

  function resetSession() {
    messages.value = [{
      id: createId(),
      role: 'assistant',
      content: 'This is your working draft. Tell me what to change and I will update it.',
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
