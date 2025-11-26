import type { ChatActionSuggestion } from '#shared/utils/types'
import type { Ref } from 'vue'
import { ref, watch } from 'vue'

interface UseChatAutoActionsOptions {
  actions: Ref<ChatActionSuggestion[]>
  isBusy: Ref<boolean>
  handler: (action: ChatActionSuggestion) => Promise<void>
}

export function useChatAutoActions(options: UseChatAutoActionsOptions) {
  const autoActionKey = ref<string | null>(null)
  const autoActionBusy = ref(false)

  if (import.meta.client) {
    watch(
      () => options.actions.value,
      async (currentActions) => {
        if (!currentActions.length) {
          autoActionKey.value = null
          return
        }

        if (options.isBusy.value || autoActionBusy.value) {
          return
        }

        const index = currentActions.findIndex(action => action.type === 'suggest_generate_from_source')
        if (index === -1) {
          return
        }

        const autoAction = currentActions[index]!
        const key = `${autoAction.type}:${autoAction.sourceContentId ?? autoAction.label ?? 'auto'}:${index}`
        if (autoActionKey.value === key) {
          return
        }

        autoActionKey.value = key
        autoActionBusy.value = true

        try {
          await options.handler(autoAction)
        } catch (error) {
          console.error('Automatic action execution failed', error)
        } finally {
          autoActionBusy.value = false
        }
      },
      { immediate: true }
    )
  }

  return {
    autoActionBusy
  }
}
