import type { ChatMessage } from '#shared/utils/types'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'

export interface PendingDraftAction {
  sourceId: string
  existingDraftId: string | null
  hasExistingDraft: boolean
  preview: any | null
}

interface DraftActionOptions {
  messages: Ref<ChatMessage[]> | (() => ChatMessage[])
  isBusy: Ref<boolean> | (() => boolean)
  status: Ref<string> | (() => string)
  contentEntries?: Ref<Array<{ id: string, sourceContentId: string | null, status: string }>> | (() => Array<{ id: string, sourceContentId: string | null, status: string }>)
  currentContentRecord?: Ref<{ id: string, sourceContentId: string | null } | null> | (() => { id: string, sourceContentId: string | null } | null)
  sessionContentId: Ref<string | null> | (() => string | null)
  contentId?: Ref<string> | (() => string | null)
  selectedContentType?: Ref<string | null> | (() => string | null)
  pendingDrafts?: Ref<Array<{ id: string, contentType: string | null }>>
  sendMessage?: (message: string, options?: { displayContent?: string, contentId?: string | null, action?: Record<string, any> }) => Promise<any>
  onRefresh?: () => Promise<void> | void
  onLoadWorkspace?: () => Promise<void> | void
}

export function useDraftAction(options: DraftActionOptions) {
  const {
    messages,
    isBusy,
    status,
    contentEntries,
    currentContentRecord,
    sessionContentId,
    contentId,
    selectedContentType,
    pendingDrafts,
    sendMessage,
    onRefresh,
    onLoadWorkspace
  } = options

  const isPublishing = ref(false)
  const toast = useToast()

  const getMessages = () => {
    const msgs = typeof messages === 'function' ? messages() : messages.value
    return msgs
  }

  const getIsBusy = () => {
    return typeof isBusy === 'function' ? isBusy() : isBusy.value
  }

  const getStatus = () => {
    return typeof status === 'function' ? status() : status.value
  }

  const getContentEntries = () => {
    if (!contentEntries)
      return []
    return typeof contentEntries === 'function' ? contentEntries() : contentEntries.value
  }

  const getCurrentContentRecord = () => {
    if (!currentContentRecord)
      return null
    return typeof currentContentRecord === 'function' ? currentContentRecord() : currentContentRecord.value
  }

  const getSessionContentId = () => {
    return typeof sessionContentId === 'function' ? sessionContentId() : sessionContentId.value
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

  const latestPlanPreview = computed(() => {
    const reversed = [...getMessages()].reverse()
    for (const entry of reversed) {
      const payload = entry.payload as Record<string, any> | null | undefined
      if (payload?.type === 'plan_preview' && typeof payload.sourceId === 'string') {
        return {
          sourceId: payload.sourceId as string,
          preview: payload.preview ?? null
        }
      }
    }
    return null
  })

  const pendingDraftAction = computed<PendingDraftAction | null>(() => {
    if (!latestPlanPreview.value) {
      return null
    }
    if (getIsBusy() || ['submitted', 'streaming'].includes(getStatus())) {
      return null
    }

    const sourceId = latestPlanPreview.value.sourceId
    if (!sourceId || typeof sourceId !== 'string') {
      return null
    }

    // Check if a draft already exists for this source
    let existingDraft: { id: string } | null = null

    // First check current content record (for DraftWorkspace)
    const current = getCurrentContentRecord()
    if (current?.sourceContentId === sourceId) {
      existingDraft = { id: current.id }
    }

    // Then check contentEntries (for QuillioWidget)
    if (!existingDraft) {
      const found = getContentEntries().find(
        entry => entry.sourceContentId === sourceId && entry.status === 'draft'
      )
      if (found) {
        existingDraft = { id: found.id }
      }
    }

    return {
      sourceId,
      existingDraftId: existingDraft?.id ?? null,
      hasExistingDraft: !!existingDraft,
      preview: latestPlanPreview.value.preview ?? null
    }
  })

  async function handleWriteDraftFromSource(sourceId?: string | null) {
    if (!sourceId) {
      toast.add({
        title: 'Source unavailable',
        description: 'Unable to locate the transcript for drafting.',
        color: 'error'
      })
      return
    }
    if (isPublishing.value || getIsBusy() || ['submitted', 'streaming'].includes(getStatus())) {
      return
    }

    // Optimistically add draft to list immediately (for QuillioWidget)
    if (pendingDrafts) {
      const tempDraftId = `temp-${sourceId}-${Date.now()}`
      const alreadyHasTemp = pendingDrafts.value.some(entry => entry.id.startsWith(`temp-${sourceId}-`))
      if (!alreadyHasTemp) {
        pendingDrafts.value.push({ id: tempDraftId, contentType: getSelectedContentType() || null })
      }
    }

    try {
      const resolvedContentId = getContentId() || getSessionContentId() || undefined

      if (sendMessage) {
        // Use sendMessage from useChatSession if provided
        await sendMessage('Please create a full draft from this transcript.', {
          displayContent: 'Write draft from transcript',
          contentId: resolvedContentId,
          action: {
            type: 'generate_content',
            sourceContentId: sourceId,
            contentId: resolvedContentId
          }
        })
      } else {
        // Fallback to direct API call
        await $fetch('/api/chat', {
          method: 'POST',
          body: {
            message: 'Please create a full draft from this transcript.',
            contentId: resolvedContentId,
            action: {
              type: 'generate_content',
              sourceContentId: sourceId,
              contentId: resolvedContentId
            }
          }
        })
      }

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

      console.error('[useDraftAction] Failed to trigger draft generation from source', error)
      toast.add({
        title: 'Unable to start draft',
        description: error?.data?.statusMessage || error?.data?.message || error?.message || 'Something went wrong while creating the draft.',
        color: 'error'
      })
    }
  }

  async function handlePublishDraft(draftId: string | null) {
    if (!draftId) {
      toast.add({
        title: 'Draft unavailable',
        description: 'Unable to locate the draft for publishing.',
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
        title: 'Draft published',
        description: response.file.url
          ? `Available at ${response.file.url}`
          : 'The latest version has been saved to your content storage.',
        color: 'primary'
      })
      if (onRefresh) {
        await onRefresh()
      }
    } catch (error: any) {
      console.error('[useDraftAction] Failed to publish draft', error)
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
    latestPlanPreview,
    pendingDraftAction,
    handleWriteDraftFromSource,
    handlePublishDraft,
    isPublishing
  }
}
