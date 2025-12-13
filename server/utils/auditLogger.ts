import { eq, sql } from 'drizzle-orm'
import { auditLog } from '~~/server/db/schema/auditLog'
import { auditLogQueue } from '~~/server/db/schema/auditLogQueue'
import { getDB } from './db'

const AUDIT_LOG_TIMEOUT_MS = 2000 // 2 second timeout for critical audit events

export async function logAuditEvent(data: {
  userId?: string
  category: 'auth' | 'email' | 'payment' | string
  action: string
  targetType?: string
  targetId?: string
  ipAddress?: string
  userAgent?: string
  status?: 'success' | 'failure' | 'pending'
  details?: string
}, options?: {
  timeout?: number
  queueOnFailure?: boolean
  throwOnFailure?: boolean
}) {
  const timeout = options?.timeout ?? AUDIT_LOG_TIMEOUT_MS
  const queueOnFailure = options?.queueOnFailure ?? true
  const throwOnFailure = options?.throwOnFailure ?? true

  try {
    const db = getDB()

    // Use Promise.race to implement timeout
    const insertPromise = db.insert(auditLog).values({
      userId: data.userId,
      category: data.category,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      status: data.status || 'success',
      details: data.details,
      createdAt: new Date()
    })

    let timeoutId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Audit log timeout after ${timeout}ms`)), timeout)
    })

    try {
      await Promise.race([insertPromise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to log audit event:', errorMessage)

    let queuedSuccessfully = false

    // Queue for retry if enabled
    if (queueOnFailure) {
      try {
        const db = getDB()
        await db.insert(auditLogQueue).values({
          userId: data.userId,
          category: data.category,
          action: data.action,
          targetType: data.targetType,
          targetId: data.targetId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          status: data.status || 'pending', // Queue items default to 'pending'
          details: data.details,
          error: errorMessage,
          retryCount: 0,
          createdAt: new Date()
        })
        queuedSuccessfully = true
      } catch (queueError) {
        // If queueing also fails, log but don't throw - we've done our best
        console.error('[Audit] Failed to queue audit event for retry:', queueError)
      }
    }

    // Re-throw if caller needs to handle failure (or if queuing failed)
    if (throwOnFailure || !queuedSuccessfully) {
      throw error
    }
  }
}

/**
 * Retry queued audit events that failed to log initially.
 * Should be called periodically by a background job.
 */
export async function retryQueuedAuditEvents(maxRetries: number = 5, batchSize: number = 100) {
  const db = getDB()

  try {
    // Get queued events that haven't exceeded max retries
    const queuedEvents = await db
      .select()
      .from(auditLogQueue)
      .where(sql`${auditLogQueue.retryCount} < ${maxRetries}`)
      .limit(batchSize)

    for (const queuedEvent of queuedEvents) {
      try {
        // Try to insert into audit log
        await db.insert(auditLog).values({
          userId: queuedEvent.userId,
          category: queuedEvent.category,
          action: queuedEvent.action,
          targetType: queuedEvent.targetType,
          targetId: queuedEvent.targetId,
          ipAddress: queuedEvent.ipAddress,
          userAgent: queuedEvent.userAgent,
          status: queuedEvent.status,
          details: queuedEvent.details,
          createdAt: queuedEvent.createdAt
        })

        // Success - delete from queue
        await db.delete(auditLogQueue).where(eq(auditLogQueue.id, queuedEvent.id))
      } catch (error) {
        // Failed again - increment retry count
        const newRetryCount = queuedEvent.retryCount + 1
        await db
          .update(auditLogQueue)
          .set({
            retryCount: newRetryCount,
            lastRetryAt: new Date(),
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          .where(eq(auditLogQueue.id, queuedEvent.id))

        // If exceeded max retries, log for manual investigation and remove from queue
        if (newRetryCount >= maxRetries) {
          console.error(`[Audit] Audit event exceeded max retries (${maxRetries}):`, {
            id: queuedEvent.id,
            category: queuedEvent.category,
            action: queuedEvent.action,
            userId: queuedEvent.userId
          })
          // Remove from queue to prevent table bloat
          await db.delete(auditLogQueue).where(eq(auditLogQueue.id, queuedEvent.id))
        }
      }
    }
  } catch (error) {
    console.error('[Audit] Failed to retry queued audit events:', error)
  }
}
