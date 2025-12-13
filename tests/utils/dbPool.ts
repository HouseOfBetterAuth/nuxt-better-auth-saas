/**
 * Shared database pool utility for tests
 * Reuses connections across tests to improve performance
 */

import pg from 'pg'

const { Pool } = pg

let sharedPool: pg.Pool | null = null

/**
 * Get or create a shared database pool for tests
 * This avoids creating/destroying pools for each test
 */
export function getSharedDbPool(): pg.Pool {
  if (!sharedPool) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set')
    }

    sharedPool = new Pool({
      connectionString: databaseUrl,
      max: 5, // Allow multiple connections for parallel tests
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 60000,
      statement_timeout: 30000, // Prevent queries from hanging indefinitely
      // Keep pool alive longer for test reuse
      keepAlive: true
    })
  }

  return sharedPool
}

/**
 * Clean up the shared pool (call in afterAll)
 */
export async function closeSharedDbPool(): Promise<void> {
  if (sharedPool) {
    try {
      await sharedPool.end()
    } finally {
      sharedPool = null
    }
  }
}
