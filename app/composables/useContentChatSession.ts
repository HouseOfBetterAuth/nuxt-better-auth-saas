import type { ChatMessage } from '#shared/utils/types'
import { useState } from '#app'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

const createId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2)
)

export function useContentChatSession(contentId: string) {
  const stateKey = (suffix: string) => `content-chat-${contentId}-${suffix}`

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

    status.value = 'submitted'
    errorMessage.value = null

    await new Promise(resolve => setTimeout(resolve, 500))

    messages.value.push({
      id: createId(),
      role: 'assistant',
      content: `(Mock) Noted. I will apply "${trimmed}" to this draft.`,
      createdAt: new Date()
    })

    status.value = 'ready'
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
