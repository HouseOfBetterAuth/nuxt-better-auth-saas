import type { Hyperdrive } from '@cloudflare/workers-types'
import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const getDatabaseUrl = () => {
// @ts-expect-error globalThis.__env__ is not defined
  const hyperdrive = (process.env.HYPERDRIVE || globalThis.__env__?.HYPERDRIVE || globalThis.HYPERDRIVE) as Hyperdrive | undefined
  if (runtimeConfig.preset == 'node-server') {
    return runtimeConfig.databaseUrl
  } else {
    return hyperdrive?.connectionString || runtimeConfig.databaseUrl
  }
}

const createPgPool = () => new pg.Pool({
  connectionString: getDatabaseUrl(),
  max: 90,
  idleTimeoutMillis: 30000
})

let pgPool: pg.Pool

// PG Pool
export const getPgPool = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!pgPool) {
      pgPool = createPgPool()
    }
    return pgPool
  } else {
    return createPgPool()
  }
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
      const value = await hubKV().get(key)
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
        await hubKV().set(key, stringValue, { ttl })
      } else {
        await hubKV().set(key, stringValue)
      }
    }
  },
  delete: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      await client.del(key)
    } else {
      await hubKV().del(key)
    }
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
