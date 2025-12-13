import type { Hyperdrive } from '@cloudflare/workers-types'
import { kv } from 'hub:kv'
import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const getDatabaseUrl = () => {
  // @ts-expect-error globalThis.__env__ is not defined
  const hyperdrive = (process.env.HYPERDRIVE || globalThis.__env__?.HYPERDRIVE || globalThis.HYPERDRIVE) as Hyperdrive | undefined
  // Use Hyperdrive if available (prod Cloudflare), otherwise DATABASE_URL
  const url = hyperdrive?.connectionString || runtimeConfig.databaseUrl
  if (!url) {
    console.error('[DB] No database URL available - Hyperdrive:', !!hyperdrive, 'DATABASE_URL:', !!runtimeConfig.databaseUrl)
    throw new Error('Database connection string is not available')
  }
  // Log connection source (but not the actual URL for security)
  if (hyperdrive?.connectionString) {
    console.log('[DB] Using Hyperdrive connection')
  } else {
    console.log('[DB] Using DATABASE_URL connection')
  }
  return url
}

const createPgPool = () => {
  const connectionString = getDatabaseUrl()
  console.log('[DB] Creating PostgreSQL pool with timeout settings')
  return new pg.Pool({
    connectionString,
    max: 90,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10 second timeout to prevent hanging in Cloudflare Workers
    statement_timeout: 30000 // 30 second query timeout
  })
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
