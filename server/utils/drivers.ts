import { kv } from 'hub:kv'
import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

interface HyperdriveBinding {
  connectionString: string
}

const getDatabaseUrl = () => {
  // Cloudflare Hyperdrive binding (available on Workers).
  const env = ((globalThis as any).__env__ || globalThis) as Record<string, unknown>
  const hyperdrive = (process.env.HYPERDRIVE
    || process.env.POSTGRES
    || env.HYPERDRIVE
    || env.POSTGRES) as HyperdriveBinding | undefined

  return hyperdrive?.connectionString || runtimeConfig.databaseUrl
}

const createPgPool = () => {
  const connectionString = getDatabaseUrl()
  if (!connectionString)
    throw new Error('Database connection string is not available')

  return new pg.Pool({
    connectionString,
    idleTimeoutMillis: 30000
  })
}

const PG_POOL_KEY = '__quillio_pgPool'
type GlobalWithPool = typeof globalThis & { [PG_POOL_KEY]?: pg.Pool }
const globalRef = globalThis as GlobalWithPool

export const getPgPool = () => {
  // Match HouseOfBetterAuth behavior:
  // - Reuse a singleton pool only in node-server.
  // - In Workers, return a fresh pool (avoid keeping a long-lived pg Pool across isolates/requests).
  if (runtimeConfig.preset == 'node-server') {
    if (!globalRef[PG_POOL_KEY])
      globalRef[PG_POOL_KEY] = createPgPool()
    return globalRef[PG_POOL_KEY]
  }

  return createPgPool()
}

let redisClient: Redis | undefined

const getRedisClient = () => {
  if (redisClient)
    return redisClient

  if (runtimeConfig.preset == 'node-server') {
    redisClient = new Redis(runtimeConfig.redisUrl)
    return redisClient
  }
}

export const cacheClient = {
  get: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      const value = await client.get(key)
      return value
    }

    const value = await kv.get<string>(key)
    if (!value)
      return null
    return value
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    const client = getRedisClient()
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
    if (client) {
      if (ttl)
        await client.set(key, stringValue, 'EX', ttl)
      else
        await client.set(key, stringValue)
    } else {
      if (ttl)
        await kv.set(key, stringValue, { ttl })
      else
        await kv.set(key, stringValue)
    }
  },
  delete: async (key: string) => {
    const client = getRedisClient()
    if (client)
      await client.del(key)
    else
      await kv.del(key)
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
