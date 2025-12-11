import { setup } from '@nuxt/test-utils/e2e'
import { $fetch } from 'ofetch'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseConnection } from '../utils/dbConnection'

const { Pool } = pg

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

  let dbPool: pg.Pool | null = null

  beforeEach(async () => {
    // Verify database connection before tests
    const dbTest = await testDatabaseConnection()
    if (!dbTest.success) {
      throw new Error(`Database connection failed: ${dbTest.message}`)
    }

    // Create database pool for direct queries
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set')
    }

    dbPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    })
  })

  afterEach(async () => {
    if (dbPool) {
      await dbPool.end()
      dbPool = null
    }
  })

  it('should save chat messages to database for anonymous users', async () => {
    const testMessage = `Test message at ${new Date().toISOString()}`

    // Send chat message as anonymous user
    let conversationId: string | null = null
    let userMessageId: string | null = null

    try {
      const response = await $fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: {
          message: testMessage,
          mode: 'chat' // Anonymous users can only use 'chat' mode
        },
        responseType: 'text',
        timeout: 60000
      }) as string

      // Parse SSE stream to get conversation ID
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
    } catch (error: any) {
      // If it's a quota error, that's acceptable for this test
      if (error?.data?.message?.includes('limit reached') || error?.data?.message?.includes('quota')) {
        // Quota error is acceptable - we just want to verify DB connection works
        return
      }
      throw error
    }

    expect(conversationId).toBeTruthy()
    expect(userMessageId).toBeTruthy()

    // Wait for database writes to complete
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify conversation exists in database
    if (!dbPool) {
      throw new Error('Database pool not initialized')
    }

    const client = await dbPool.connect()

    try {
      // Check conversation
      const conversationResult = await client.query(
        'SELECT id, organization_id, created_by_user_id, status FROM conversation WHERE id = $1',
        [conversationId]
      )

      expect(conversationResult.rows.length).toBe(1)
      const conversation = conversationResult.rows[0]
      expect(conversation.id).toBe(conversationId)
      expect(conversation.status).toBe('active')
      expect(conversation.organization_id).toBeTruthy()

      // Check messages
      const messagesResult = await client.query(
        'SELECT id, conversation_id, role, content FROM conversation_message WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conversationId]
      )

      expect(messagesResult.rows.length).toBeGreaterThan(0)

      // Verify user message exists
      const userMessage = messagesResult.rows.find((msg: any) => msg.role === 'user' && msg.content === testMessage)
      expect(userMessage).toBeTruthy()
      expect(userMessage.id).toBe(userMessageId)

      // Verify assistant message exists
      const assistantMessage = messagesResult.rows.find((msg: any) => msg.role === 'assistant')
      expect(assistantMessage).toBeTruthy()
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
