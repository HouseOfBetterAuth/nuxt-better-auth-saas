<script setup lang="ts">
import type { ContentType } from '#shared/constants/contentTypes'
import type { ChatMessage } from '#shared/utils/types'
import { CONTENT_TYPE_OPTIONS } from '#shared/constants/contentTypes'
import { shallowRef } from 'vue'
import { useClipboard, useDebounceFn } from '@vueuse/core'

import BillingUpgradeModal from '~/components/billing/UpgradeModal.vue'
import PromptComposer from './PromptComposer.vue'
import QuotaLimitModal from './QuotaLimitModal.vue'

const props = withDefaults(defineProps<{
  initialDraftId?: string | null
  routeSync?: boolean
}>(), {
  initialDraftId: null,
  routeSync: true
})

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const { loggedIn, user, useActiveOrganization, refreshActiveOrg, signIn } = auth
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  sessionId,
  sessionContentId,
  createContentFromConversation,
  resetSession
} = useChatSession()

const prompt = ref('')
const promptSubmitting = ref(false)
const createDraftLoading = ref(false)
const createDraftError = ref<string | null>(null)
const showQuotaModal = ref(false)
const quotaModalData = ref<{ limit: number | null, used: number | null, remaining: number | null, planLabel: string | null } | null>(null)
const showUpgradeModal = ref(false)
const selectedContentType = ref<ContentType>(CONTENT_TYPE_OPTIONS[0]?.value ?? 'blog_post')

const selectedContentTypeOption = computed(() => {
  if (!CONTENT_TYPE_OPTIONS.length) {
    return null
  }
  return CONTENT_TYPE_OPTIONS.find(option => option.value === selectedContentType.value) ?? CONTENT_TYPE_OPTIONS[0]
})
const linkedSources = ref<Array<{ id: string, type: 'transcript', value: string }>>([])
const { copy } = useClipboard()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()

const parseDraftLimitValue = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }
  return fallback
}

const guestDraftLimit = computed(() => parseDraftLimitValue(runtimeConfig.public?.draftQuota?.anonymous, 5))
const verifiedDraftLimit = computed(() => parseDraftLimitValue(runtimeConfig.public?.draftQuota?.verified, 25))

const activeWorkspaceId = ref<string | null>(null)
const workspaceDetail = shallowRef<any | null>(null)
const workspaceLoading = ref(false)
const draftQuotaState = useState<DraftQuotaUsagePayload | null>('draft-quota-usage', () => null)
const workspacePayloadCache = useState<Map<string, { payload: any | null, timestamp: number }>>('workspace-payload-cache', () => new Map())
const WORKSPACE_CACHE_TTL_MS = 30_000
const debouncedRefreshDrafts = useDebounceFn(() => refreshDrafts(), 300)

const scheduleIdleTask = (fn: () => void) => {
  if (typeof window === 'undefined')
    return
  const idle = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined
  if (typeof idle === 'function') {
    idle(() => fn())
  } else {
    setTimeout(() => fn(), 200)
  }
}

const prefetchWorkspacePayload = (contentId?: string | null) => {
  if (!import.meta.client || !contentId) {
    return
  }
  scheduleIdleTask(() => {
    const cacheEntry = workspacePayloadCache.value.get(contentId)
    const now = Date.now()
    if (cacheEntry && (now - cacheEntry.timestamp) < WORKSPACE_CACHE_TTL_MS) {
      return
    }
    $fetch<{ workspace?: any | null }>(`/api/chat/workspace/${contentId}`)
      .then((response) => {
        workspacePayloadCache.value.set(contentId, {
          payload: response?.workspace ?? null,
          timestamp: Date.now()
        })
      })
      .catch(() => {
        // Ignore prefetch errors
      })
  })
}
const debouncedRefreshDrafts = useDebounceFn(() => refreshDrafts(), 300)
interface DraftQuotaUsagePayload {
  limit: number | null
  used: number | null
  remaining: number | null
  label?: string | null
  unlimited?: boolean
  profile?: 'anonymous' | 'verified' | 'paid'
}

interface WorkspaceResponse {
  contents: any[]
  draftQuota?: DraftQuotaUsagePayload | null
}

const {
  data: workspaceDraftsPayload,
  pending: draftsPending,
  refresh: refreshDrafts
} = await useFetch<WorkspaceResponse>('/api/chat/drafts-list', {
  default: () => ({
    contents: []
  })
})
const isWorkspaceActive = computed(() => Boolean(activeWorkspaceId.value))

const draftQuotaUsage = computed<DraftQuotaUsagePayload | null>(() => workspaceDraftsPayload.value?.draftQuota ?? null)
const remainingDraftQuota = computed(() => {
  const usage = draftQuotaUsage.value
  if (!usage)
    return null
  if (typeof usage.remaining === 'number')
    return usage.remaining
  if (typeof usage.limit === 'number' && typeof usage.used === 'number')
    return usage.limit - usage.used
  return null
})
const hasReachedDraftQuota = computed(() => {
  const remaining = remainingDraftQuota.value
  if (remaining === null)
    return false
  return remaining <= 0
})
const quotaBadgeLabel = computed(() => {
  const usage = draftQuotaUsage.value
  if (usage?.unlimited) {
    return '∞'
  }
  if (!usage || typeof usage.limit !== 'number') {
    return null
  }
  const limit = Math.max(0, usage.limit)
  const used = Math.max(0, usage.used ?? (limit - (usage.remaining ?? 0)))
  return `${Math.min(used, limit)}/${limit}`
})
const quotaPlanLabel = computed(() => draftQuotaUsage.value?.label ?? (loggedIn.value ? 'Current plan' : 'Guest access'))
const quotaBadgeAriaLabel = computed(() => {
  if (!quotaBadgeLabel.value)
    return 'Draft quota details'
  return `${quotaBadgeLabel.value} drafts used on ${quotaPlanLabel.value}. Tap for plan details.`
})

watch(draftQuotaUsage, (value) => {
  if (value) {
    draftQuotaState.value = {
      limit: value.limit ?? null,
      used: value.used ?? null,
      remaining: value.remaining ?? null,
      label: value.label ?? null,
      unlimited: value.unlimited ?? false
    }
  } else {
    draftQuotaState.value = null
  }
}, { immediate: true, deep: true })

const contentEntries = computed(() => {
  const list = Array.isArray(workspaceDraftsPayload.value?.contents) ? workspaceDraftsPayload.value?.contents : []
  return list.map((entry: any) => {
    // Support new lightweight format with _computed fields
    if (entry._computed) {
      let updatedAt: Date | null = null
      if (entry.content.updatedAt) {
        const parsedDate = new Date(entry.content.updatedAt)
        updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
      }

      return {
        id: entry.content.id,
        title: entry.content.title || 'Untitled draft',
        slug: entry.content.slug,
        status: entry.content.status,
        updatedAt,
        contentType: entry.currentVersion?.frontmatter?.contentType || entry.content.contentType,
        sectionsCount: entry._computed.sectionsCount || 0,
        wordCount: entry._computed.wordCount || 0,
        sourceType: entry.sourceContent?.sourceType ?? null,
        additions: entry._computed.additions,
        deletions: entry._computed.deletions
      }
    }

    // Fallback for old format (backwards compatibility)
    const sections = Array.isArray(entry.currentVersion?.sections) ? entry.currentVersion.sections : []
    const wordCount = sections.reduce((sum: number, section: Record<string, any>) => {
      const rawValue = typeof section.wordCount === 'string' ? Number.parseInt(section.wordCount, 10) : Number(section.wordCount)
      const safeValue = Number.isFinite(rawValue) ? rawValue : 0
      return sum + safeValue
    }, 0)

    let updatedAt: Date | null = null
    if (entry.content.updatedAt) {
      const parsedDate = new Date(entry.content.updatedAt)
      updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
    }

    const versionStats = entry.currentVersion?.diffStats
    const fmStats = entry.currentVersion?.frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
    const additions = Number(versionStats?.additions ?? fmStats?.additions ?? 0)
    const deletions = Number(versionStats?.deletions ?? fmStats?.deletions ?? 0)

    return {
      id: entry.content.id,
      title: entry.content.title || 'Untitled draft',
      slug: entry.content.slug,
      status: entry.content.status,
      updatedAt,
      contentType: entry.currentVersion?.frontmatter?.contentType || entry.content.contentType,
      sectionsCount: sections.length,
      wordCount: Number.isFinite(wordCount) ? wordCount : 0,
      sourceType: entry.sourceContent?.sourceType ?? null,
      additions: Number.isFinite(additions) ? additions : undefined,
      deletions: Number.isFinite(deletions) ? deletions : undefined
    }
  })
})

const activeWorkspaceEntry = computed(() => contentEntries.value.find(entry => entry.id === activeWorkspaceId.value) ?? null)
const isWorkspaceLoading = computed(() => workspaceLoading.value && isWorkspaceActive.value && !workspaceDetail.value)
const canStartDraft = computed(() => messages.value.length > 0 && !!sessionId.value && !isBusy.value)
const isStreaming = computed(() => ['submitted', 'streaming'].includes(status.value))
const uiStatus = computed(() => status.value)
const shouldShowWhatsNew = computed(() => !isWorkspaceActive.value && messages.value.length === 0)

const autoDraftTriggered = ref(false)
const draftAutoFailCount = ref(0)
const lastAutoDraftAttempt = ref<number | null>(null)
const lastAttemptedMessageCount = ref(0)
const MAX_AUTO_DRAFT_RETRIES = 3
const AUTO_DRAFT_COOLDOWN_MS = 5000 // 5 seconds

const createDraftCta = computed(() => {
  if (draftQuotaUsage.value?.unlimited) {
    return 'Create draft'
  }
  if (hasReachedDraftQuota.value) {
    return loggedIn.value ? 'Upgrade to keep drafting' : 'Create an account to keep drafting'
  }
  if (user.value?.emailVerified) {
    return 'Create draft'
  }
  const remaining = remainingDraftQuota.value
  return remaining !== null ? `Save draft (${Math.max(0, remaining)} left)` : 'Create draft'
})
const quotaHelperText = computed(() => {
  if (draftQuotaUsage.value?.unlimited) {
    return `${quotaPlanLabel.value || 'Pro plan'} unlocks unlimited drafts.`
  }
  const remaining = remainingDraftQuota.value
  if (remaining === null)
    return null
  if (remaining > 0) {
    return loggedIn.value
      ? `${remaining} draft${remaining === 1 ? '' : 's'} left on your plan`
      : `${remaining} draft${remaining === 1 ? '' : 's'} left before creating an account`
  }
  return loggedIn.value ? 'Upgrade your plan to unlock more drafts.' : 'Create an account to unlock more drafts.'
})

const handleWhatsNewSelect = (payload: { id: 'youtube' | 'transcript' | 'seo', command?: string }) => {
  if (!payload) {
    return
  }
  if (payload.command) {
    prompt.value = payload.command
  }
}

const openQuotaModal = (payload?: { limit?: number | null, used?: number | null, remaining?: number | null, label?: string | null } | null) => {
  const fallback = draftQuotaUsage.value

  // Preserve unlimited plan semantics when there is no explicit override
  if (!payload && fallback?.unlimited) {
    quotaModalData.value = {
      limit: null,
      used: fallback.used ?? null,
      remaining: fallback.remaining ?? null,
      planLabel: fallback.label ?? quotaPlanLabel.value ?? null
    }
    showQuotaModal.value = true
    return
  }

  const baseLimit = typeof payload?.limit === 'number'
    ? payload.limit
    : (typeof fallback?.limit === 'number' ? fallback.limit : null)
  const normalizedLimit = baseLimit ?? (loggedIn.value ? verifiedDraftLimit.value : guestDraftLimit.value)

  // Derive usedValue from payload, fallback, or remaining if provided, otherwise default to 0
  let usedValue: number | null = null
  if (typeof payload?.used === 'number') {
    usedValue = payload.used
  } else if (typeof fallback?.used === 'number') {
    usedValue = fallback.used
  } else if (typeof payload?.remaining === 'number' && baseLimit !== null) {
    usedValue = Math.max(0, baseLimit - payload.remaining)
  } else if (typeof fallback?.remaining === 'number' && baseLimit !== null) {
    usedValue = Math.max(0, baseLimit - fallback.remaining)
  }

  const finalUsed = usedValue ?? 0
  const finalLimit = baseLimit ?? normalizedLimit

  // Calculate remaining: prefer explicit remaining, otherwise compute from limit and used
  const remainingValue = payload?.remaining ?? fallback?.remaining ?? (finalLimit !== null ? Math.max(0, finalLimit - finalUsed) : null)

  quotaModalData.value = {
    limit: finalLimit,
    used: finalUsed,
    remaining: remainingValue,
    planLabel: payload?.label ?? fallback?.label ?? quotaPlanLabel.value ?? null
  }
  showQuotaModal.value = true
}

const quotaModalMessage = computed(() => {
  if (!loggedIn.value) {
    return `Make an account to unlock ${verifiedDraftLimit.value} total drafts or archive drafts to continue writing.`
  }
  if (draftQuotaUsage.value?.unlimited) {
    return 'Your current plan includes unlimited drafts.'
  }
  return 'Starter plans have a draft limit. Upgrade to unlock unlimited drafts or archive drafts to continue writing.'
})

const quotaModalTitle = computed(() => {
  const limit = quotaModalData.value?.limit ?? draftQuotaUsage.value?.limit ?? null
  const used = quotaModalData.value?.used ?? draftQuotaUsage.value?.used ?? null
  if (typeof limit === 'number') {
    const remaining = Math.max(0, limit - (typeof used === 'number' ? used : 0))
    return `You have ${remaining}/${limit} drafts remaining.`
  }
  if (draftQuotaUsage.value?.unlimited) {
    return 'Unlimited drafts unlocked.'
  }
  return loggedIn.value ? 'Upgrade to unlock more drafts.' : 'Create an account for more drafts.'
})

const quotaPrimaryLabel = computed(() => {
  if (!loggedIn.value)
    return 'Sign up'
  if (draftQuotaUsage.value?.unlimited)
    return 'Close'
  return 'Upgrade'
})

const handleQuotaBadgeClick = () => {
  openQuotaModal()
}

const handleQuotaModalPrimary = () => {
  showQuotaModal.value = false
  if (draftQuotaUsage.value?.unlimited) {
    // For unlimited plans, just close the modal
    return
  }
  if (loggedIn.value) {
    showUpgradeModal.value = true
    return
  }
  const destination = `/signup?redirect=${encodeURIComponent('/')}`
  router.push(destination)
}

const handleQuotaModalCancel = () => {
  showQuotaModal.value = false
}

const handleUpgradeSuccess = async () => {
  showUpgradeModal.value = false
  await refreshActiveOrg()
  await refreshDrafts()
}

const handleQuotaGoogleSignup = () => {
  showQuotaModal.value = false
  if (typeof window === 'undefined')
    return
  try {
    signIn.social?.({
      provider: 'google',
      callbackURL: window.location.href
    })
  } catch (error) {
    console.error('Failed to start Google signup', error)
  }
}

const handleQuotaEmailSignup = () => {
  showQuotaModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signup?redirect=${encodeURIComponent(redirect)}`)
}

if (import.meta.client) {
  const handleQuotaEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ limit?: number, used?: number, remaining?: number, label?: string, unlimited?: boolean }>).detail
    openQuotaModal(detail || undefined)
  }
  onMounted(() => {
    window.addEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
}

const handlePromptSubmit = async (value?: string) => {
  const input = typeof value === 'string' ? value : prompt.value
  let trimmed = input.trim()
  if (!trimmed) {
    return
  }
  const normalized = normalizePromptCommands(trimmed)
  if (!normalized) {
    return
  }
  trimmed = normalized
  const transcriptHandled = await maybeHandleTranscriptSubmission(trimmed)
  if (transcriptHandled) {
    prompt.value = ''
    return
  }
  promptSubmitting.value = true
  try {
    await sendMessage(trimmed)
    prefetchWorkspacePayload(sessionContentId.value || activeWorkspaceId.value)
    prompt.value = ''
  } finally {
    promptSubmitting.value = false
  }
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function addLinkedSource(entry: { type: 'transcript', value: string }) {
  linkedSources.value = [
    ...linkedSources.value,
    {
      id: createLocalId(),
      type: entry.type,
      value: entry.value
    }
  ]
}

const transcriptPrefixPattern = /^transcript attachment:\s*/i
const transcriptCommandPattern = /^@transcript\s*/i
const youtubeCommandPattern = /^@youtube(?:\s+|$)/i

function shouldTreatAsTranscript(input: string) {
  const value = input.trim()
  if (!value) {
    return false
  }
  if (transcriptPrefixPattern.test(value)) {
    return true
  }
  if (transcriptCommandPattern.test(value)) {
    return true
  }
  const timestampMatches = value.match(/\b\d{2}:\d{2}:\d{2}\b/g)?.length ?? 0
  const hashHeadingMatches = value.split(/\n+/).filter(line => line.trim().startsWith('#')).length
  return value.length > 800 && (timestampMatches >= 3 || hashHeadingMatches >= 2)
}

function extractTranscriptBody(input: string) {
  return input
    .replace(transcriptPrefixPattern, '')
    .replace(transcriptCommandPattern, '')
    .trim()
}

function normalizePromptCommands(input: string): string | null {
  if (youtubeCommandPattern.test(input)) {
    const url = input.replace(/^@youtube\s*/i, '').trim()
    if (!url) {
      toast.add({
        color: 'warning',
        title: 'Add a YouTube link',
        description: 'Use @youtube followed by a full video URL to start drafting.'
      })
      return null
    }
    return url
  }
  return input
}

async function submitTranscript(text: string) {
  if (!text) {
    return
  }
  const transcriptMessage = [
    'Transcript attachment:',
    text
  ].join('\n\n')
  const summary = `Transcript attached (${text.length.toLocaleString()} characters)`

  promptSubmitting.value = true
  try {
    await sendMessage(transcriptMessage, { displayContent: summary })
    addLinkedSource({ type: 'transcript', value: text })
  } catch (error: any) {
    console.error('Failed to send transcript message', error)
    const errorMsg = error?.data?.message || error?.message || 'Unable to send transcript. Please try again.'
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      parts: [{ type: 'text', text: `❌ ${errorMsg}` }],
      createdAt: new Date()
    })
  } finally {
    promptSubmitting.value = false
  }
}

async function maybeHandleTranscriptSubmission(raw: string) {
  if (!shouldTreatAsTranscript(raw)) {
    return false
  }
  const text = extractTranscriptBody(raw)
  await submitTranscript(text || raw.trim())
  return true
}

function removeLinkedSource(id: string) {
  linkedSources.value = linkedSources.value.filter(entry => entry.id !== id)
}

const loadWorkspaceDetail = async (contentId: string) => {
  if (!contentId) {
    workspaceDetail.value = null
    return
  }

  const cacheEntry = workspacePayloadCache.value.get(contentId)
  const now = Date.now()

  if (cacheEntry) {
    workspaceDetail.value = cacheEntry.payload
    if (now - cacheEntry.timestamp < WORKSPACE_CACHE_TTL_MS) {
      workspaceLoading.value = false
      return
    }
  } else {
    workspaceDetail.value = null
  }

  workspaceLoading.value = !cacheEntry
  try {
    const response = await $fetch<{ workspace?: any | null }>(`/api/chat/workspace/${contentId}`)
    const payload = response?.workspace ?? null
    workspaceDetail.value = payload
    workspacePayloadCache.value.set(contentId, {
      payload,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Unable to load workspace', error)
    if (!cacheEntry) {
      workspaceDetail.value = null
    }
  } finally {
    workspaceLoading.value = false
  }
}

const normalizeDraftId = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : null
  }
  return typeof value === 'string' ? value : null
}

const resetWorkspaceState = () => {
  activeWorkspaceId.value = null
  workspaceDetail.value = null
  workspaceLoading.value = false
}

const routeDraftId = computed(() => normalizeDraftId(route.query.draft))
const standaloneDraftId = computed(() => props.initialDraftId ?? routeDraftId.value ?? null)

const syncWorkspace = async (draftId: string | null) => {
  if (!draftId) {
    resetWorkspaceState()
    return
  }
  if (activeWorkspaceId.value === draftId && workspaceDetail.value) {
    return
  }
  activeWorkspaceId.value = draftId
  await loadWorkspaceDetail(draftId)
}

const scheduleSyncWorkspace = useDebounceFn((draftId: string | null) => {
  void syncWorkspace(draftId)
}, 200)

const updateDraftRoute = async (draftId: string | null) => {
  const nextQuery = { ...route.query }
  if (draftId) {
    nextQuery.draft = draftId
  } else {
    delete nextQuery.draft
  }
  try {
    await router.replace({ query: nextQuery })
  } catch (error) {
    console.warn('Failed to update draft route', error)
  }
}

const initialDraftId = computed(() => (props.routeSync ? routeDraftId.value : standaloneDraftId.value) ?? null)

await syncWorkspace(initialDraftId.value)

const activateWorkspace = async (draftId: string | null) => {
  if (props.routeSync) {
    await updateDraftRoute(draftId)
  } else {
    await syncWorkspace(draftId)
  }
}

const openWorkspace = async (entry: { id: string, slug?: string | null }) => {
  await activateWorkspace(entry.id)
}

const resetConversation = () => {
  prompt.value = ''
  linkedSources.value = []
  createDraftError.value = null
  autoDraftTriggered.value = false
  draftAutoFailCount.value = 0
  lastAutoDraftAttempt.value = null
  lastAttemptedMessageCount.value = 0
  resetSession()
}

const closeWorkspace = async () => {
  const previousWorkspaceId = activeWorkspaceId.value
  await activateWorkspace(null)
  resetConversation()
  prefetchWorkspacePayload(previousWorkspaceId)
}

const handleCreateDraft = async () => {
  createDraftError.value = null
  if (!canStartDraft.value) {
    return false
  }

  if (hasReachedDraftQuota.value) {
    openQuotaModal()
    return false
  }

  if (!activeOrgState.value?.data?.slug) {
    await refreshActiveOrg()
  }

  if (sessionContentId.value) {
    await refreshDrafts()
    await activateWorkspace(sessionContentId.value)
    return true
  }

  createDraftLoading.value = true
  try {
    const firstUserMessage = messages.value.find(message => message.role === 'user')
    const fallbackTitle = 'Quillio draft'
    const response = await createContentFromConversation({
      title: firstUserMessage?.parts?.[0]?.text?.slice(0, 80) || fallbackTitle,
      contentType: selectedContentType.value,
      messageIds: messages.value.map(message => message.id)
    })

    if (response?.content?.id) {
      await refreshDrafts()
      await activateWorkspace(response.content.id)
      // Reset failure counter on success
      draftAutoFailCount.value = 0
      lastAttemptedMessageCount.value = 0
      return true
    }
    return false
  } catch (error: any) {
    // Check if this is a quota limit error
    if (error?.data?.limitReached === true) {
      openQuotaModal({
        limit: error.data.limit || null,
        used: error.data.used || null,
        remaining: error.data.remaining || null,
        label: error.data.label || null
      })
      return false
    }

    const errorMsg = error?.data?.statusMessage || error?.data?.message || error?.message || 'Unable to create a draft from this conversation.'
    createDraftError.value = errorMsg

    // Also add error as a chat message
    messages.value.push({
      id: createLocalId(),
      role: 'assistant',
      parts: [{ type: 'text', text: `❌ Error: ${errorMsg}` }],
      createdAt: new Date()
    })
    return false
  } finally {
    createDraftLoading.value = false
  }
}

const handleCreateDraftClick = async () => {
  await handleCreateDraft()
}

watch(
  () => ({
    active: isWorkspaceActive.value,
    canStart: canStartDraft.value,
    count: messages.value.length,
    loading: createDraftLoading.value
  }),
  async ({ active, canStart, count, loading }) => {
    // Don't attempt if workspace is active, loading, already triggered, can't start, no messages, or limit reached
    if (active || loading || autoDraftTriggered.value || !canStart || count === 0 || hasReachedDraftQuota.value)
      return

    // Prevent infinite retries: check failure counter and cooldown
    if (draftAutoFailCount.value >= MAX_AUTO_DRAFT_RETRIES) {
      return
    }

    // Check cooldown period
    const now = Date.now()
    if (lastAutoDraftAttempt.value !== null && (now - lastAutoDraftAttempt.value) < AUTO_DRAFT_COOLDOWN_MS) {
      return
    }

    // Don't retry for the same message count (prevents loop when error message is added)
    if (lastAttemptedMessageCount.value === count) {
      return
    }

    autoDraftTriggered.value = true
    lastAutoDraftAttempt.value = now
    lastAttemptedMessageCount.value = count

    const success = await handleCreateDraft()
    if (!success) {
      draftAutoFailCount.value++
      autoDraftTriggered.value = false
      // Keep lastAttemptedMessageCount to prevent immediate retry when error message is added
    } else {
      // Success: reset failure counter and message count tracking
      draftAutoFailCount.value = 0
      lastAttemptedMessageCount.value = 0
    }
  }
)

if (props.routeSync) {
  watch(routeDraftId, (draftId) => {
    scheduleSyncWorkspace(draftId ?? null)
  })
} else {
  watch(standaloneDraftId, (draftId) => {
    if (!import.meta.client) {
      return
    }
    scheduleSyncWorkspace(draftId ?? null)
  })
}

const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  const text = message.parts[0]?.text || ''
  prompt.value = text
  await handlePromptSubmit(text)
}

function handleCopy(message: ChatMessage) {
  const text = message.parts[0]?.text || ''
  copy(text)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied successfully.',
    color: 'primary'
  })
}

// Populate drafts list cache for header reuse
const draftsListCache = useState<Map<string, any>>('drafts-list-cache', () => new Map())

watch(workspaceDraftsPayload, (payload) => {
  if (!payload?.contents)
    return
  const cache = draftsListCache.value
  payload.contents.forEach((entry: any) => {
    if (entry.content?.id) {
      cache.set(entry.content.id, entry)
    }
  })
}, { immediate: true, deep: true })

if (import.meta.client) {
  watch(loggedIn, () => {
    debouncedRefreshDrafts()
  }, { immediate: true })
}
</script>

<template>
  <div class="w-full py-8 sm:py-12 space-y-8">
    <div class="w-full">
      <div
        v-if="!isWorkspaceActive"
        class="space-y-6 mb-8"
      >
        <h1 class="text-2xl font-semibold text-center">
          What should we write next?
        </h1>
      </div>
      <div class="space-y-8">
        <!-- Error messages are now shown in chat, but keep banner as fallback for non-chat errors -->
        <UAlert
          v-if="errorMessage && !messages.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :description="errorMessage"
          class="w-full"
        />

        <div
          v-if="isWorkspaceActive && activeWorkspaceEntry"
          class="space-y-6 w-full"
        >
          <ChatDraftWorkspace
            v-if="workspaceDetail?.content?.id"
            :content-id="workspaceDetail.content.id"
            :organization-slug="workspaceDetail.content.slug || activeOrgState?.value?.data?.slug || null"
            :initial-payload="workspaceDetail"
            :show-back-button="true"
            :back-to="null"
            @close="closeWorkspace"
          />
        </div>

        <template v-else>
          <div
            v-if="messages.length"
            class="space-y-6 w-full"
          >
            <div class="w-full">
              <div
                v-if="isStreaming"
                class="flex items-center justify-center gap-2 text-sm text-muted-500 mb-6"
              >
                <span class="h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
                <span>Quillio is thinking...</span>
              </div>

              <UChatMessages
                class="py-4"
                :messages="messages"
                :status="uiStatus"
                should-auto-scroll
                :assistant="{
                  actions: [
                    {
                      label: 'Copy',
                      icon: 'i-lucide-copy',
                      onClick: (e, message) => handleCopy(message as ChatMessage)
                    },
                    {
                      label: 'Regenerate',
                      icon: 'i-lucide-rotate-ccw',
                      onClick: (e, message) => handleRegenerate(message as ChatMessage)
                    }
                  ]
                }"
                :user="{
                  actions: [
                    {
                      label: 'Copy',
                      icon: 'i-lucide-copy',
                      onClick: (e, message) => handleCopy(message as ChatMessage)
                    },
                    {
                      label: 'Send again',
                      icon: 'i-lucide-send',
                      onClick: (e, message) => {
                        const text = (message as ChatMessage).parts[0]?.text || ''
                        if (text) {
                          handlePromptSubmit(text)
                        }
                      }
                    }
                  ]
                }"
              >
                <template #content="{ message }">
                  <div class="whitespace-pre-line">
                    {{ message.parts[0]?.text }}
                  </div>
                </template>
              </UChatMessages>
            </div>
          </div>

          <div class="w-full space-y-6 mt-8">
            <!-- Show linked sources if any -->
            <div
              v-if="linkedSources.length"
              class="flex flex-wrap gap-2 mb-2"
            >
              <UBadge
                v-for="source in linkedSources"
                :key="source.id"
                size="sm"
                color="primary"
                class="flex items-center gap-1"
              >
                <UIcon
                  name="i-lucide-file-text"
                />
                Transcript
                <UButton
                  variant="link"
                  size="xs"
                  icon="i-lucide-x"
                  @click.stop="removeLinkedSource(source.id)"
                />
              </UBadge>
            </div>

            <!-- Add more information -->
            <!-- Main chat input -->
            <div class="w-full flex justify-center">
              <div class="w-full">
                <PromptComposer
                  v-model="prompt"
                  placeholder="Paste a transcript or describe what you need..."
                  :disabled="isBusy || promptSubmitting"
                  :status="promptSubmitting ? 'submitted' : uiStatus"
                  :context-label="isWorkspaceActive ? 'Active draft' : undefined"
                  :context-value="activeWorkspaceEntry?.title || null"
                  @submit="handlePromptSubmit"
                >
                  <template #footer>
                    <USelectMenu
                      v-if="selectedContentTypeOption"
                      v-model="selectedContentType"
                      :items="CONTENT_TYPE_OPTIONS"
                      value-key="value"
                      option-attribute="label"
                      variant="ghost"
                      size="sm"
                    >
                      <template #leading>
                        <UIcon
                          :name="selectedContentTypeOption.icon"
                          class="w-4 h-4"
                        />
                      </template>
                    </USelectMenu>
                  </template>
                </PromptComposer>
              </div>
            </div>

            <div
              v-if="shouldShowWhatsNew"
              class="w-full mt-8"
            >
              <ChatWhatsNewRow @select="handleWhatsNewSelect" />
            </div>

            <!-- Draft creation - only show when there are messages -->
            <div
              v-if="messages.length"
              class="space-y-3 mt-6"
            >
              <div class="flex flex-col gap-2">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2">
                  <UButton
                    color="primary"
                    :loading="createDraftLoading"
                    :disabled="!canStartDraft"
                    class="w-full sm:w-auto"
                    @click="handleCreateDraftClick"
                  >
                    {{ createDraftCta }}
                  </UButton>
                  <UButton
                    v-if="quotaBadgeLabel"
                    size="xs"
                    variant="soft"
                    color="neutral"
                    class="font-mono text-xs rounded-full px-4 py-3 w-full sm:w-auto justify-center min-h-[44px]"
                    :aria-label="quotaBadgeAriaLabel"
                    @click="handleQuotaBadgeClick"
                  >
                    {{ quotaBadgeLabel }}
                  </UButton>
                </div>
                <p
                  v-if="quotaHelperText"
                  class="text-xs text-muted-500 text-center"
                >
                  {{ quotaHelperText }}
                </p>
              </div>

              <UAlert
                v-if="createDraftError"
                color="error"
                variant="soft"
                icon="i-lucide-alert-triangle"
                :description="createDraftError"
              />
            </div>
          </div>
        </template>
      </div>
      <div
        v-if="!isWorkspaceActive && contentEntries.length > 0"
        class="mt-8"
      >
        <ChatDraftsList
          :drafts-pending="draftsPending"
          :content-entries="contentEntries"
          @open-workspace="openWorkspace"
        />
      </div>
    </div>

    <QuotaLimitModal
      v-model:open="showQuotaModal"
      :title="quotaModalTitle"
      :limit="quotaModalData?.limit ?? draftQuotaUsage?.limit ?? null"
      :used="quotaModalData?.used ?? draftQuotaUsage?.used ?? null"
      :remaining="quotaModalData?.remaining ?? draftQuotaUsage?.remaining ?? null"
      :plan-label="quotaModalData?.planLabel ?? quotaPlanLabel"
      :message="quotaModalMessage"
      :primary-label="quotaPrimaryLabel"
      @primary="handleQuotaModalPrimary"
      @cancel="handleQuotaModalCancel"
    >
      <template
        v-if="!loggedIn"
        #actions
      >
        <div class="flex flex-col gap-3 pt-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-simple-icons-google"
              class="flex-1 justify-center"
              @click="handleQuotaGoogleSignup"
            >
              Continue with Google
            </UButton>
            <div class="flex-1 text-center sm:text-left">
              <button
                type="button"
                class="text-sm text-primary-400 font-semibold hover:underline"
                @click="handleQuotaEmailSignup"
              >
                Sign up
              </button>
            </div>
          </div>
        </div>
      </template>
    </QuotaLimitModal>
    <BillingUpgradeModal
      v-model:open="showUpgradeModal"
      :organization-id="activeOrgState?.value?.data?.id || undefined"
      @upgraded="handleUpgradeSuccess"
    />
  </div>
</template>
