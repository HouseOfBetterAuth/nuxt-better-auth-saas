import { kv } from 'hub:kv'
import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

// Avoid a hard dependency on Cloudflare types at runtime/lint time.
interface Hyperdrive {
  connectionString: string
}

const DB_SLOW_QUERY_THRESHOLD_MS = 3000
const DB_QUERY_TIMEOUT_MS = 15000
const DB_POOL_WAIT_WARNING_MS = 3000
const DB_POOL_BACKPRESSURE_LOG_INTERVAL_MS = 10_000
const DB_QUERY_START_LOG_INTERVAL_MS = 10_000
const DB_COLD_POOL_LOG_INTERVAL_MS = 10_000
const DB_CONNECT_OK_LOG_INTERVAL_MS = 10_000
const DB_BYPASS_HYPERDRIVE_ENV = 'NUXT_DB_BYPASS_HYPERDRIVE'
// Versioned so new deploys can re-log once per isolate.
const DB_HOST_LOGGED_KEY = '__quillio_dbHostLogged_v2'

function tryExtractDbHost(url: string): { host: string, isPooler: boolean } | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    return { host, isPooler: host.includes('-pooler.') }
  } catch {
    // Fallback for non-standard URL parsing environments.
    // Example: postgresql://user:pass@host/db?params
    const match = url.match(/^[a-z]+:\/\/[^@]+@([^/]+)\//i)
    const host = match?.[1]
    if (!host) {
      return null
    }
    return { host, isPooler: host.includes('-pooler.') }
  }
}

const poolStats = (pool: pg.Pool) => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount
})

const getDatabaseUrl = () => {
  // @ts-expect-error globalThis.__env__ is not defined
  const hyperdrive = (process.env.HYPERDRIVE || globalThis.__env__?.HYPERDRIVE || globalThis.HYPERDRIVE) as Hyperdrive | undefined
  // Default to bypassing Hyperdrive for now. Set NUXT_DB_BYPASS_HYPERDRIVE=false to re-enable.
  const bypassHyperdrive = process.env[DB_BYPASS_HYPERDRIVE_ENV] !== 'false'
  // Use Hyperdrive if available (prod Cloudflare), otherwise DATABASE_URL
  const url = (!bypassHyperdrive ? hyperdrive?.connectionString : undefined) || runtimeConfig.databaseUrl
  if (!url) {
    console.error('[DB] No database URL available - Hyperdrive:', !!hyperdrive, 'DATABASE_URL:', !!runtimeConfig.databaseUrl)
    throw new Error('Database connection string is not available')
  }
  // Log connection source (but not the actual URL for security)
  if (hyperdrive?.connectionString && !bypassHyperdrive) {
    console.log('[DB] Using Hyperdrive connection')
  } else {
    if (hyperdrive?.connectionString && bypassHyperdrive) {
      console.warn(`[DB] Bypassing Hyperdrive due to ${DB_BYPASS_HYPERDRIVE_ENV}=true`)
    }
    console.log('[DB] Using DATABASE_URL connection')
  }
  return url
}

const instrumentPool = (pool: pg.Pool) => {
  const marker = '__quillio_instrumented'
  if ((pool as any)[marker]) {
    return pool
  }
  (pool as any)[marker] = true

  let lastBackpressureLogAt = 0
  let lastColdPoolLogAt = 0
  let lastConnectOkLogAt = 0
  const maybeLogBackpressure = (reason: string, extra?: Record<string, unknown>) => {
    // Only log if there's actually backpressure, and throttle.
    if (pool.waitingCount <= 0) {
      return
    }
    const now = Date.now()
    if (now - lastBackpressureLogAt < DB_POOL_BACKPRESSURE_LOG_INTERVAL_MS) {
      return
    }
    lastBackpressureLogAt = now
    console.warn('[DB] Pool backpressure detected', {
      reason,
      pool: poolStats(pool),
      ...extra
    })
  }

  const maybeLogColdPool = (reason: string, extra?: Record<string, unknown>) => {
    // Cold pool = no connections have been established yet in this isolate.
    if (pool.totalCount > 0) {
      return
    }
    const now = Date.now()
    if (now - lastColdPoolLogAt < DB_COLD_POOL_LOG_INTERVAL_MS) {
      return
    }
    lastColdPoolLogAt = now
    console.warn('[DB] Cold pool detected (no connections yet)', {
      reason,
      pool: poolStats(pool),
      ...extra
    })
  }

  pool.on('error', (error) => {
    console.error('[DB] Pool error detected', { error })
  })

  const originalConnect = pool.connect.bind(pool)
  ;(pool as any).connect = (async (...args: any[]) => {
    const start = Date.now()
    // If something is already queued waiting for a connection, surface it early.
    maybeLogBackpressure('before connect')
    maybeLogColdPool('before connect')
    try {
      const client = await (originalConnect as any)(...args)
      const wait = Date.now() - start
      if (wait > DB_POOL_WAIT_WARNING_MS) {
        console.warn('[DB] Slow pool.connect detected', {
          waitMs: wait,
          pool: poolStats(pool)
        })
      } else if (pool.totalCount <= 1) {
        // Helpful signal for cold starts / newly created pools without spamming.
        const now = Date.now()
        if (now - lastConnectOkLogAt > DB_CONNECT_OK_LOG_INTERVAL_MS) {
          lastConnectOkLogAt = now
          console.log('[DB] pool.connect ok', {
            waitMs: wait,
            pool: poolStats(pool)
          })
        }
      }
      return client
    } catch (error) {
      const wait = Date.now() - start
      console.error('[DB] pool.connect failed', {
        waitMs: wait,
        pool: poolStats(pool),
        error
      })
      throw error
    }
  }) as any

  const originalQuery = pool.query.bind(pool)
  ;(pool as any).query = (async (...args: any[]) => {
    const start = Date.now()
    const queryPreview = extractQueryPreview(args)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const startPoolSnapshot = poolStats(pool)

    maybeLogBackpressure('before query', { query: queryPreview })
    maybeLogColdPool('before query', { query: queryPreview })

    // Low-volume "query start" trace to correlate with timeouts in prod without spamming.
    const now = Date.now()
    const markerKey = '__quillio_lastQueryStartLogAt'
    const ref = pool as any
    const lastStartLogAt = typeof ref[markerKey] === 'number' ? ref[markerKey] : 0
    if (now - lastStartLogAt > DB_QUERY_START_LOG_INTERVAL_MS) {
      ref[markerKey] = now
      console.log('[DB] Query start', { query: queryPreview, pool: startPoolSnapshot })
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        console.error('[DB] Query exceeded timeout threshold', {
          timeoutMs: DB_QUERY_TIMEOUT_MS,
          query: queryPreview,
          poolAtStart: startPoolSnapshot,
          poolAtTimeout: poolStats(pool)
        })
        const error = new Error(`Database query timed out after ${DB_QUERY_TIMEOUT_MS}ms`)
        ;(error as any).statusCode = 504
        reject(error)
      }, DB_QUERY_TIMEOUT_MS)
    })

    const queryPromise = (originalQuery as any)(...args) as Promise<any>
    queryPromise.catch((error: any) => {
      console.error('[DB] Query failed', {
        error,
        query: queryPreview
      })
    })

    try {
      const result = await Promise.race([queryPromise, timeoutPromise])
      return result as Awaited<typeof queryPromise>
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      const duration = Date.now() - start
      if (duration > DB_SLOW_QUERY_THRESHOLD_MS) {
        console.warn('[DB] Slow query detected', {
          durationMs: duration,
          query: queryPreview,
          poolAtStart: startPoolSnapshot,
          poolAtEnd: poolStats(pool)
        })
      }
    }
  }) as any

  return pool
}

function extractQueryPreview(args: any[]): string {
  const [first] = args
  const queryText = typeof first === 'string'
    ? first
    : typeof first === 'object' && first && 'text' in first
      ? String((first as { text?: string }).text || '')
      : ''
  const normalized = queryText.replace(/\s+/g, ' ').trim()
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized || '[unknown query]'
}

const createPgPool = () => {
  const connectionString = getDatabaseUrl()
  // Log selected host (safe) once per isolate/process for diagnostics.
  // We log here (pool creation) because we already know this code path runs in prod.
  if (!(globalThis as any)[DB_HOST_LOGGED_KEY]) {
    ;(globalThis as any)[DB_HOST_LOGGED_KEY] = true
    const info = tryExtractDbHost(connectionString)
    if (info) {
      console.log('[DB] Database host selected', info)
    } else {
      console.warn('[DB] Database host selected (unparseable URL)')
    }
  }
  console.log('[DB] Creating PostgreSQL pool with timeout settings')
  const pool = new pg.Pool({
    connectionString,
    max: 90,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10 second timeout to prevent hanging in Cloudflare Workers
    // IMPORTANT:
    // Our app-level timeout (DB_QUERY_TIMEOUT_MS) is implemented via Promise.race.
    // If statement_timeout is longer than the app timeout, the underlying query can
    // keep running and tie up pool connections, causing cascading timeouts.
    //
    // Keep statement_timeout <= DB_QUERY_TIMEOUT_MS so Postgres cancels and frees
    // the connection promptly.
    statement_timeout: DB_QUERY_TIMEOUT_MS
  })
  return instrumentPool(pool)
}

const PG_POOL_KEY = '__quillio_pgPool'
type GlobalWithPool = typeof globalThis & { [PG_POOL_KEY]?: pg.Pool }
const globalRef = globalThis as GlobalWithPool

const getExistingPool = () => globalRef[PG_POOL_KEY]
const setExistingPool = (pool: pg.Pool) => {
  globalRef[PG_POOL_KEY] = pool
  return pool
}

// PG Pool
export const getPgPool = () => {
  const existingPool = getExistingPool()
  if (existingPool) {
    return existingPool
  }
  return setExistingPool(createPgPool())
}

// Cache Client
let redisClient: Redis | undefined

const getRedisClient = () => {
  if (redisClient) {
    return redisClient
  } else {
    if (runtimeConfig.preset == 'node-server') {
      redisClient = new Redis(runtimeConfig.redisUrl)
      return redisClient
    }
  }
}

export const cacheClient = {
  get: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      const value = await client.get(key)
      return value
    } else {
      const value = await kv.get(key)
      if (!value) {
        return null
      }
      return JSON.stringify(value)
    }
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    const client = getRedisClient()
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
    if (client) {
      if (ttl) {
        await client.set(key, stringValue, 'EX', ttl)
      } else {
        await client.set(key, stringValue)
      }
    } else {
      if (ttl) {
        await kv.set(key, stringValue, { ttl })
      } else {
        await kv.set(key, stringValue)
      }
    }
  },
  delete: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      await client.del(key)
    } else {
      await kv.del(key)
    }
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
