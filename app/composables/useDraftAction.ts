import type { Ref } from 'vue'
import { ref } from 'vue'

interface DraftActionOptions {
  isBusy: Ref<boolean> | (() => boolean)
  status: Ref<string> | (() => string)
  conversationContentId: Ref<string | null> | (() => string | null)
  contentId?: Ref<string> | (() => string | null)
  selectedContentType?: Ref<string | null> | (() => string | null)
  pendingDrafts?: Ref<Array<{ id: string, contentType: string | null }>> // Legacy name, represents pending content items
  sendMessage?: (message: string, options?: { displayContent?: string, contentId?: string | null }) => Promise<any>
  onRefresh?: () => Promise<void> | void
  onLoadWorkspace?: () => Promise<void> | void
}

export function useDraftAction(options: DraftActionOptions) {
  const {
    isBusy,
    status,
    conversationContentId,
    contentId,
    selectedContentType,
    pendingDrafts,
    sendMessage,
    onRefresh,
    onLoadWorkspace
  } = options

  const isPublishing = ref(false)
  const toast = useToast()

  const getIsBusy = () => {
    return typeof isBusy === 'function' ? isBusy() : isBusy.value
  }

  const getStatus = () => {
    return typeof status === 'function' ? status() : status.value
  }

  const getConversationContentId = () => {
    return typeof conversationContentId === 'function' ? conversationContentId() : conversationContentId.value
  }

  const getContentId = () => {
    if (!contentId)
      return null
    return typeof contentId === 'function' ? contentId() : contentId.value
  }

  const getSelectedContentType = () => {
    if (!selectedContentType)
      return null
    return typeof selectedContentType === 'function' ? selectedContentType() : selectedContentType.value
  }

  async function handleWriteDraftFromSource(sourceId?: string | null) {
    if (!sourceId) {
      toast.add({
        title: 'Source unavailable',
        description: 'Unable to locate the transcript for content generation.',
        color: 'error'
      })
      return
    }
    if (isPublishing.value || getIsBusy() || ['submitted', 'streaming'].includes(getStatus())) {
      return
    }

    // Optimistically add content to list immediately (for QuillioWidget)
    if (pendingDrafts) {
      const tempContentId = `temp-${sourceId}-${Date.now()}`
      const alreadyHasTemp = pendingDrafts.value.some(entry => entry.id.startsWith(`temp-${sourceId}-`))
      if (!alreadyHasTemp) {
        pendingDrafts.value.push({ id: tempContentId, contentType: getSelectedContentType() || null })
      }
    }

    try {
      const resolvedContentId = getContentId() || getConversationContentId() || undefined

      if (!sendMessage) {
        throw new Error('sendMessage is required')
      }

      // Send natural language message - the agent will determine the appropriate tool to use
      await sendMessage(`Please create content from the source with ID ${sourceId}.`, {
        displayContent: 'Write content from transcript',
        contentId: resolvedContentId
      })

      if (onLoadWorkspace) {
        await onLoadWorkspace()
      } else if (onRefresh) {
        await onRefresh()
      }
    } catch (error: any) {
      // Remove temp entry on error (for QuillioWidget)
      if (pendingDrafts) {
        const tempId = `temp-${sourceId}-`
        pendingDrafts.value = pendingDrafts.value.filter(entry => !entry.id.startsWith(tempId))
      }

      console.error('[useDraftAction] Failed to trigger content generation from source', error)
      toast.add({
        title: 'Unable to start content generation',
        description: error?.data?.statusMessage || error?.data?.message || error?.message || 'Something went wrong while creating the content.',
        color: 'error'
      })
    }
  }

  async function handlePublishDraft(draftId: string | null) {
    if (!draftId) {
      toast.add({
        title: 'Content unavailable',
        description: 'Unable to locate the content for publishing.',
        color: 'error'
      })
      return
    }
    if (isPublishing.value || getIsBusy()) {
      return
    }
    try {
      isPublishing.value = true
      const response = await $fetch<{ content: { id: string, status: string, publishedAt: string | null }, file: { url: string | null } }>(`/api/content/${draftId}/publish`, {
        method: 'POST',
        body: {
          versionId: null // Use current version
        }
      })
      toast.add({
        title: 'Content published',
        description: response.file.url
          ? `Available at ${response.file.url}`
          : 'The latest version has been saved to your content storage.',
        color: 'primary'
      })
      if (onRefresh) {
        await onRefresh()
      }
    } catch (error: any) {
      console.error('[useDraftAction] Failed to publish content', error)
      toast.add({
        title: 'Publish failed',
        description: error?.data?.statusMessage || error?.data?.message || error?.message || 'Something went wrong while publishing.',
        color: 'error'
      })
    } finally {
      isPublishing.value = false
    }
  }

  return {
    handleWriteDraftFromSource,
    handlePublishDraft,
    isPublishing
  }
}
