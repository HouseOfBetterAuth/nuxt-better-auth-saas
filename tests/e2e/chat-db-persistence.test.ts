import { setup } from '@nuxt/test-utils/e2e'
import { $fetch } from 'ofetch'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseConnection } from '../utils/dbConnection'
import { closeSharedDbPool, getSharedDbPool } from '../utils/dbPool'

/**
 * E2E test for chat API database persistence
 *
 * Verifies that:
 * - Chat messages are properly saved to the database
 * - Conversations are created correctly
 * - Anonymous users can create conversations
 * - Database connection is working
 */
describe('chat database persistence E2E', async () => {
  await setup({ host: process.env.NUXT_TEST_APP_URL })

  const baseURL = process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'

  const getAnonymousCookie = async () => {
    const res = await $fetch.raw(`${baseURL}/api/conversations`, { method: 'GET' })
    const setCookie = res.headers.get('set-cookie') || ''
    // Only keep cookie name=value pairs
    return setCookie
      .split(',')
      .map(part => part.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ')
  }

  // Verify database connection once before all tests
  beforeAll(async () => {
    const dbTest = await testDatabaseConnection()
    if (!dbTest.success) {
      throw new Error(`Database connection failed: ${dbTest.message}`)
    }
  })

  beforeEach(async () => {
    // Pool is now shared - no need to create/destroy per test
  })

  // Clean up shared pool after all tests
  afterAll(async () => {
    await closeSharedDbPool()
  })

  it('should save chat messages to database for anonymous users', async () => {
    const testMessage = `Test message at ${new Date().toISOString()}`

    // Send chat message as anonymous user
    let conversationId: string | null = null
    let userMessageId: string | null = null

    try {
      const cookie = await getAnonymousCookie()
      const response = await $fetch(`${baseURL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: {
          message: testMessage,
          mode: 'chat' // Anonymous users can only use 'chat' mode
        },
        responseType: 'text',
        timeout: 60000
      }) as string

      // Parse SSE stream to get conversation ID
      if (!response || response.trim().length === 0) {
        console.warn('Empty response from chat API, will search database')
      } else {
        const lines = response.split('\n')
        let currentEventType: string | null = null

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine)
            continue

          if (trimmedLine.startsWith('event: ')) {
            currentEventType = trimmedLine.slice(7)
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6))

              if (currentEventType === 'conversation:update' || currentEventType === 'conversation:final') {
                if (data.conversationId) {
                  conversationId = data.conversationId
                }
              }

              if (currentEventType === 'messages:complete' && data.messages) {
                for (const msg of data.messages) {
                  if (msg.role === 'user' && msg.content === testMessage) {
                    userMessageId = msg.id
                  }
                }
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error: any) {
      // If it's a 404, the server route might not be available in test environment
      if (error?.status === 404 || error?.statusCode === 404) {
        throw new Error(`API endpoint not found. This test requires a running server. Error: ${error.message}`)
      }
      throw error
    }

    // If conversationId not found in SSE, we'll find it in database by message content
    if (!conversationId) {
      console.warn('Conversation ID not found in SSE stream, will search database by message content')
    }

    // Use shared pool instead of per-test pool
    const dbPool = getSharedDbPool()

    // Poll database until conversation and messages appear or timeout
    // Reduced wait time since we optimized the endpoint
    const maxWaitTime = 3000 // Reduced from 5000
    const pollInterval = 150 // Reduced from 200
    const maxConsecutiveErrors = 3 // Fail fast after 3 consecutive errors
    let elapsedTime = 0
    let conversationFound = false
    let messagesFound = false
    let consecutiveErrors = 0
    let lastError: Error | null = null

    const client = await dbPool.connect()

    // If conversationId wasn't found in SSE, we'll find it during polling
    // Don't fail immediately - let the polling loop handle it

    // Helper to determine if error is transient (retryable) or persistent (should fail)
    const isTransientError = (error: any): boolean => {
      // Connection timeout/refused - might be transient
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        return true
      }
      // Network errors - might be transient
      if (error.message?.includes('timeout') || error.message?.includes('ECONNRESET')) {
        return true
      }
      // Permission denied, syntax errors, etc. are persistent
      if (error.code === '28P01' || error.code === '42601' || error.code === '42P01') {
        return false
      }
      // Default: treat as persistent if we can't determine
      return false
    }

    try {
      while (elapsedTime < maxWaitTime && (!conversationFound || !messagesFound)) {
        try {
          // If we don't have conversationId yet, try to find it by message content
          // Use a more efficient query with EXISTS instead of JOIN
          if (!conversationId) {
            const findResult = await client.query(
              `SELECT c.id FROM conversation c
               WHERE EXISTS (
                 SELECT 1 FROM conversation_message cm
                 WHERE cm.conversation_id = c.id
                 AND cm.content = $1
                 AND cm.role = $2
               )
               ORDER BY c.updated_at DESC LIMIT 1`,
              [testMessage, 'user']
            )
            if (findResult.rows.length > 0) {
              conversationId = findResult.rows[0].id
            }
          }

          if (!conversationId) {
            // Still no conversation ID, wait and retry
            await new Promise(resolve => setTimeout(resolve, pollInterval))
            elapsedTime += pollInterval
            continue
          }

          // Check conversation and messages in a single query for efficiency
          const conversationResult = await client.query(
            'SELECT id, organization_id, created_by_user_id, status FROM conversation WHERE id = $1',
            [conversationId]
          )

          // Empty result is expected during polling - not an error
          if (conversationResult.rows.length > 0) {
            conversationFound = true

            // Check messages - use a more efficient query
            const messagesResult = await client.query(
              'SELECT id, conversation_id, role, content FROM conversation_message WHERE conversation_id = $1 ORDER BY created_at ASC',
              [conversationId]
            )

            if (messagesResult.rows.length > 0) {
              messagesFound = true

              // Verify conversation details
              const conversation = conversationResult.rows[0]
              expect(conversation.id).toBe(conversationId)
              expect(conversation.status).toBe('active')
              expect(conversation.organization_id).toBeTruthy()

              // Verify user message exists
              const userMessage = messagesResult.rows.find((msg: any) => msg.role === 'user' && msg.content === testMessage)
              expect(userMessage).toBeTruthy()
              // If we got userMessageId from SSE, verify it matches; otherwise just verify message exists
              if (userMessageId) {
                expect(userMessage.id).toBe(userMessageId)
              }

              // Verify assistant message exists
              const assistantMessage = messagesResult.rows.find((msg: any) => msg.role === 'assistant')
              expect(assistantMessage).toBeTruthy()

              // All checks passed, exit polling loop
              break
            }
          }

          // Successful query - reset error counter
          consecutiveErrors = 0
          lastError = null
        } catch (queryError: any) {
          consecutiveErrors++
          lastError = queryError

          // Check if error is persistent (non-transient)
          if (!isTransientError(queryError)) {
            throw new Error(
              `Persistent database error during polling: ${queryError.message} (code: ${queryError.code || 'unknown'})`
            )
          }

          // Transient error - log and check threshold
          console.warn(`Transient query error during polling (${consecutiveErrors}/${maxConsecutiveErrors}):`, queryError.message)

          if (consecutiveErrors >= maxConsecutiveErrors) {
            throw new Error(
              `Too many consecutive database errors (${consecutiveErrors}). Last error: ${queryError.message} (code: ${queryError.code || 'unknown'})`
            )
          }
        }

        if (elapsedTime < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, pollInterval))
          elapsedTime += pollInterval
        }
      }

      if (!conversationFound) {
        const errorMsg = lastError
          ? `Conversation not found in database after waiting. Last database error: ${lastError.message}`
          : 'Conversation not found in database after waiting'
        throw new Error(errorMsg)
      }

      if (!messagesFound) {
        const errorMsg = lastError
          ? `Messages not found in database after waiting. Last database error: ${lastError.message}`
          : 'Messages not found in database after waiting'
        throw new Error(errorMsg)
      }
    } finally {
      client.release()
    }
  }, 90000) // 90 second timeout for LLM response

  it('should verify database connection is working', async () => {
    const result = await testDatabaseConnection()
    expect(result.success).toBe(true)
    expect(result.details).toBeTruthy()
    expect(result.details?.dbName).toBeTruthy()
  })
})
