import type { ConversationPreviewMetadataPatch } from '~~/server/services/conversation'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createError, getQuery } from 'h3'
import * as schema from '~~/server/db/schema'
import { patchConversationPreviewMetadata } from '~~/server/services/conversation'
import { areConversationQuotasDisabled, getAuthSession, getConversationQuotaUsage } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { validateNumber } from '~~/server/utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const QUOTAS_DISABLED = areConversationQuotasDisabled()

interface ConversationPreviewState {
  hasLastMessage: boolean
  lastMessage: string | null
  hasLatestArtifact: boolean
  latestArtifactTitle: string | null
  hasArtifactCount: boolean
  artifactCount: number
}

const createPreviewState = (): ConversationPreviewState => ({
  hasLastMessage: false,
  lastMessage: null,
  hasLatestArtifact: false,
  latestArtifactTitle: null,
  hasArtifactCount: false,
  artifactCount: 0
})

const buildAnonymousQuotaPayload = () => {
  if (QUOTAS_DISABLED) {
    return {
      limit: null,
      used: 0,
      remaining: null,
      label: 'Unlimited access',
      unlimited: true,
      profile: 'anonymous' as const
    }
  }

  const anonymousLimit = typeof (runtimeConfig.public as any)?.conversationQuota?.anonymous === 'number'
    ? (runtimeConfig.public as any).conversationQuota.anonymous
    : 10

  return {
    limit: anonymousLimit,
    used: 0,
    remaining: anonymousLimit,
    label: 'Guest access',
    unlimited: false,
    profile: 'anonymous' as const
  }
}

/**
 * List conversations for the organization with artifact previews
 * Returns conversations with their associated content artifacts and quota information
 */
export default defineEventHandler(async (event) => {
  // 1. Fast path: Check session first to avoid expensive anonymous user creation
  // Anonymous users have no persisted conversations, so we can return immediately
  const session = await getAuthSession(event)

  // If no session exists, this is likely an anonymous user - return fast path immediately
  if (!session?.user) {
    return {
      conversations: [],
      conversationQuota: buildAnonymousQuotaPayload()
    }
  }

  // 2. Signed-in user path - get user from context or session
  const user = event.context.user || session.user

  // Cache user in context for subsequent calls
  if (!event.context.user) {
    event.context.user = user
  }

  // 3. Signed-in or anonymous user path - should be fast and direct
  const db = getDB()
  const query = getQuery(event)

  const getQueryValue = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
      return value[0]
    }
    return value
  }

  const parseOptionalInt = (
    raw: string | undefined,
    field: string,
    defaultValue: number,
    min?: number,
    max?: number
  ) => {
    if (raw === undefined) {
      return defaultValue
    }
    const trimmed = raw.trim()
    if (!trimmed) {
      return defaultValue
    }
    const parsed = validateNumber(trimmed, field, min, max)
    if (!Number.isInteger(parsed)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} must be an integer`
      })
    }
    return parsed
  }

  const limit = parseOptionalInt(
    getQueryValue(query.limit as string | string[] | undefined),
    'limit',
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT
  )

  const pageRaw = getQueryValue(query.page as string | string[] | undefined)
  let offset: number

  if (pageRaw) {
    const page = parseOptionalInt(pageRaw, 'page', 1, 1, 10000)
    offset = (page - 1) * limit
  } else {
    offset = parseOptionalInt(
      getQueryValue(query.offset as string | string[] | undefined) ?? '0',
      'offset',
      0,
      0,
      1000000
    )
  }

  // Get organizationId from session first (fast path), then fallback to requireActiveOrganization
  // Reuse the session we already fetched to avoid duplicate getAuthSession calls
  const betterAuthSession = session as any
  let organizationId = betterAuthSession?.session?.activeOrganizationId
    ?? betterAuthSession?.data?.session?.activeOrganizationId
    ?? betterAuthSession?.activeOrganizationId

  // If not in session, use requireActiveOrganization (which will do DB lookup)
  if (!organizationId) {
    const orgResult = await requireActiveOrganization(event, user.id)
    organizationId = orgResult.organizationId
  } else {
    // Verify organization exists and user has access (fast PK lookup)
    const [orgExists] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (!orgExists) {
      // Fallback to requireActiveOrganization if org doesn't exist
      const orgResult = await requireActiveOrganization(event, user.id)
      organizationId = orgResult.organizationId
    } else {
      // Quick membership check
      const [membership] = await db
        .select()
        .from(schema.member)
        .where(and(
          eq(schema.member.userId, user.id),
          eq(schema.member.organizationId, organizationId)
        ))
        .limit(1)

      if (!membership) {
        // Fallback to requireActiveOrganization if no membership
        const orgResult = await requireActiveOrganization(event, user.id)
        organizationId = orgResult.organizationId
      }
    }
  }

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Active organization not found'
    })
  }

  // Fetch base conversations
  const conversations = await db
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
      sourceContentId: schema.conversation.sourceContentId,
      createdByUserId: schema.conversation.createdByUserId,
      status: schema.conversation.status,
      metadata: schema.conversation.metadata,
      createdAt: schema.conversation.createdAt,
      updatedAt: schema.conversation.updatedAt
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.organizationId, organizationId))
    .orderBy(desc(schema.conversation.updatedAt))
    .limit(limit)
    .offset(offset)

  // Early return if no conversations
  if (conversations.length === 0) {
    const conversationQuota = QUOTAS_DISABLED
      ? {
          limit: null,
          used: 0,
          remaining: null,
          label: 'Unlimited access',
          unlimited: true,
          profile: (user?.isAnonymous ? 'anonymous' : 'paid') as const
        }
      : await getConversationQuotaUsage(db, organizationId, user, event)
    return {
      conversations: [],
      conversationQuota
    }
  }

  const previewStates = new Map<string, ConversationPreviewState>()
  const pendingPreviewUpdates = new Map<string, ConversationPreviewMetadataPatch>()
  const missingMessageIds: string[] = []
  const missingArtifactIds: string[] = []
  const missingArtifactCountIds: string[] = []

  const getPendingPreviewPatch = (conversationId: string) => {
    let patch = pendingPreviewUpdates.get(conversationId)
    if (!patch) {
      patch = {}
      pendingPreviewUpdates.set(conversationId, patch)
    }
    return patch
  }

  for (const conv of conversations) {
    const state = createPreviewState()
    const metadata = conv.metadata as Record<string, any> | null
    const preview = metadata?.preview as Record<string, any> | null

    if (preview && typeof preview === 'object') {
      if (Object.prototype.hasOwnProperty.call(preview, 'latestMessage')) {
        state.hasLastMessage = true
        const previewMessage = preview.latestMessage as Record<string, any> | null
        state.lastMessage = typeof previewMessage?.content === 'string' ? previewMessage.content : null
      }

      if (Object.prototype.hasOwnProperty.call(preview, 'latestArtifact')) {
        state.hasLatestArtifact = true
        const artifact = preview.latestArtifact as Record<string, any> | null
        const title = artifact?.title
        state.latestArtifactTitle = title == null ? null : String(title)
      }

      if (typeof preview.artifactCount === 'number') {
        state.hasArtifactCount = true
        state.artifactCount = preview.artifactCount
      }
    }

    if (!state.hasLastMessage) {
      missingMessageIds.push(conv.id)
    }
    if (!state.hasLatestArtifact) {
      missingArtifactIds.push(conv.id)
    }
    if (!state.hasArtifactCount) {
      missingArtifactCountIds.push(conv.id)
    }

    previewStates.set(conv.id, state)
  }

  const conversationQuotaPromise = QUOTAS_DISABLED
    ? Promise.resolve({
        limit: null,
        used: 0,
        remaining: null,
        label: 'Unlimited access',
        unlimited: true,
        profile: (user?.isAnonymous ? 'anonymous' : 'paid') as const
      })
    : getConversationQuotaUsage(db, organizationId, user, event)

  if (missingMessageIds.length > 0) {
    const messages = await db
      .select({
        conversationId: schema.conversationMessage.conversationId,
        content: schema.conversationMessage.content,
        role: schema.conversationMessage.role,
        createdAt: schema.conversationMessage.createdAt
      })
      .from(schema.conversationMessage)
      .where(inArray(schema.conversationMessage.conversationId, missingMessageIds))
      .orderBy(desc(schema.conversationMessage.createdAt))

    const lastMessageMap = new Map<string, typeof messages[number]>()
    for (const message of messages) {
      if (!lastMessageMap.has(message.conversationId)) {
        lastMessageMap.set(message.conversationId, message)
      }
    }

    for (const conversationId of missingMessageIds) {
      const message = lastMessageMap.get(conversationId)
      const state = previewStates.get(conversationId)
      if (!state) {
        continue
      }
      if (message) {
        state.lastMessage = message.content
        const patch = getPendingPreviewPatch(conversationId)
        patch.latestMessage = {
          role: message.role,
          content: message.content,
          createdAt: message.createdAt
        }
      } else {
        state.lastMessage = null
      }
      state.hasLastMessage = true
    }
  }

  if (missingArtifactIds.length > 0) {
    const artifacts = await db
      .select({
        conversationId: schema.content.conversationId,
        title: schema.content.title,
        updatedAt: schema.content.updatedAt
      })
      .from(schema.content)
      .where(inArray(schema.content.conversationId, missingArtifactIds))
      .orderBy(desc(schema.content.updatedAt))

    const latestArtifactMap = new Map<string, typeof artifacts[number]>()
    for (const artifact of artifacts) {
      if (!latestArtifactMap.has(artifact.conversationId)) {
        latestArtifactMap.set(artifact.conversationId, artifact)
      }
    }

    for (const conversationId of missingArtifactIds) {
      const artifact = latestArtifactMap.get(conversationId)
      const state = previewStates.get(conversationId)
      if (!state) {
        continue
      }
      const artifactTitle = artifact?.title
      state.latestArtifactTitle = artifactTitle == null ? null : String(artifactTitle)
      state.hasLatestArtifact = true
      const patch = getPendingPreviewPatch(conversationId)
      patch.latestArtifact = {
        title: artifactTitle == null ? null : String(artifactTitle),
        updatedAt: artifact?.updatedAt ?? null
      }
    }
  }

  if (missingArtifactCountIds.length > 0) {
    const artifactCountsRaw = await db
      .select({
        conversationId: schema.content.conversationId,
        count: sql<number>`COUNT(*)`.as('count')
      })
      .from(schema.content)
      .where(inArray(schema.content.conversationId, missingArtifactCountIds))
      .groupBy(schema.content.conversationId)

    const artifactCountMap = new Map<string, number>(
      artifactCountsRaw.map(row => [row.conversationId, Number(row.count)])
    )

    for (const conversationId of missingArtifactCountIds) {
      const state = previewStates.get(conversationId)
      if (!state) {
        continue
      }
      const countValue = artifactCountMap.get(conversationId) ?? 0
      state.artifactCount = countValue
      state.hasArtifactCount = true
      const patch = getPendingPreviewPatch(conversationId)
      patch.artifactCount = countValue
    }
  }

  const schedulePreviewBackfill = () => {
    if (pendingPreviewUpdates.size === 0) {
      return
    }

    const runBackfill = async () => {
      for (const [conversationId, patch] of pendingPreviewUpdates.entries()) {
        try {
          await patchConversationPreviewMetadata(db, conversationId, organizationId, patch)
        } catch (error) {
          console.error('[Conversations] Failed to patch preview metadata', {
            conversationId,
            error
          })
        }
      }
    }

    const promise = runBackfill()
    if (typeof (event as any).waitUntil === 'function') {
      event.waitUntil(promise)
    } else {
      promise.catch((error) => {
        console.error('[Conversations] Preview metadata backfill error', error)
      })
    }
  }

  schedulePreviewBackfill()

  const conversationQuota = await conversationQuotaPromise

  return {
    conversations: conversations.map((conv) => {
      const preview = previewStates.get(conv.id) ?? createPreviewState()
      const artifactCount = preview.artifactCount
      const recentArtifactTitle = preview.latestArtifactTitle
      const lastMessage = preview.lastMessage
      const title = conv.metadata?.title || 'Untitled conversation'

      return {
        id: conv.id,
        organizationId: conv.organizationId,
        sourceContentId: conv.sourceContentId,
        createdByUserId: conv.createdByUserId,
        status: conv.status,
        metadata: conv.metadata,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        _computed: {
          artifactCount,
          latestArtifactTitle: recentArtifactTitle,
          title,
          lastMessage
        }
      }
    }),
    conversationQuota
  }
})
