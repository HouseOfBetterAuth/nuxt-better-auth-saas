/**
 * Database connection test utilities
 * Used for verifying database connectivity and connection string configuration
 */

import { config } from 'dotenv'
import pg from 'pg'

// Load environment variables
config()

const { Pool } = pg

export interface DatabaseConnectionTestResult {
  success: boolean
  message: string
  details?: {
    host?: string
    port?: string
    database?: string
    sslMode?: string
    channelBinding?: string
    currentTime?: string
    pgVersion?: string
    dbName?: string
  }
  error?: {
    message: string
    code?: string
  }
}

/**
 * Test database connection using the app's connection logic
 * Simulates how the application connects to the database
 */
export async function testDatabaseConnection(): Promise<DatabaseConnectionTestResult> {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    return {
      success: false,
      message: 'DATABASE_URL is not set in environment variables'
    }
  }

  // Simulate the getDatabaseUrl function from drivers.ts
  // In local dev, Hyperdrive is undefined, so it uses DATABASE_URL
  const connectionString = databaseUrl

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
  })

  try {
    const client = await pool.connect()

    // Test a simple query
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version, current_database() as db_name')

    const details = {
      currentTime: result.rows[0].current_time,
      pgVersion: result.rows[0].pg_version.split(',')[0],
      dbName: result.rows[0].db_name
    }

    // Parse connection string for details
    try {
      const url = new URL(connectionString.replace(/^postgresql:\/\//, 'http://'))
      const params = new URLSearchParams(url.search)
      Object.assign(details, {
        host: url.hostname,
        port: url.port || '5432 (default)',
        database: url.pathname.slice(1),
        sslMode: params.get('sslmode') || 'not specified',
        channelBinding: params.get('channel_binding') || 'not specified'
      })
    } catch {
      // Ignore parsing errors
    }

    client.release()
    await pool.end()

    return {
      success: true,
      message: 'Database connection successful',
      details
    }
  } catch (error: any) {
    await pool.end()
    return {
      success: false,
      message: `Connection failed: ${error.message}`,
      error: {
        message: error.message,
        code: error.code
      }
    }
  }
}
