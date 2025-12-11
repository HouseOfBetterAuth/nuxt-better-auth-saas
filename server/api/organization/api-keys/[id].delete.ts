import { and, eq } from 'drizzle-orm'
import { apiKey, member } from '~~/server/db/schema'
import { logAuditEvent } from '~~/server/utils/auditLogger'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

interface ApiKeyMetadata {
  organizationId?: string
  [key: string]: unknown
}

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized'
    })
  }

  const keyId = getRouterParam(event, 'id')
  if (!keyId) {
    throw createError({
      statusCode: 400,
      message: 'Key ID is required'
    })
  }

  const db = await useDB()

  // Fetch the key first to check organization
  const key = await db.query.apiKey.findFirst({
    where: eq(apiKey.id, keyId)
  })

  if (!key) {
    throw createError({
      statusCode: 404,
      message: 'API Key not found'
    })
  }

  // Parse metadata to get organizationId
  let orgId: string | undefined
  try {
    if (key.metadata) {
      let meta: ApiKeyMetadata | string = key.metadata
      // Handle potentially double-encoded JSON string
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta)
        } catch {
          // ignore
        }
      }
      // Try parsing again if it's still a string (double encoded)
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta)
        } catch {
          // ignore
        }
      }

      if (typeof meta !== 'string' && typeof meta.organizationId === 'string') {
        orgId = meta.organizationId
      }
    }
  } catch {
    // Ignore parse error
  }

  if (!orgId) {
    throw createError({
      statusCode: 403,
      message: 'This API key does not belong to an organization'
    })
  }

  // Verify user is Admin or Owner of this organization
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, session.user.id),
      eq(member.organizationId, orgId)
    )
  })

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw createError({
      statusCode: 403,
      message: 'You do not have permission to delete API keys for this organization'
    })
  }

  // Audit log the deletion
  await logAuditEvent({
    userId: session.user.id,
    category: 'api_key',
    action: 'api_key_deleted',
    targetType: 'api_key',
    targetId: keyId,
    details: JSON.stringify({ keyName: key.name, organizationId: orgId })
  })

  // Delete the key
  await db.delete(apiKey).where(eq(apiKey.id, keyId))

  return { success: true }
})
