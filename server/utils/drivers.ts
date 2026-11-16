import type { Hyperdrive } from '@cloudflare/workers-types'
import { kv } from 'hub:kv'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const getDatabaseUrl = () => {
  // @ts-expect-error globalThis.__env__ is not defined
  const hyperdrive = (process.env.HYPERDRIVE || globalThis.__env__?.HYPERDRIVE || globalThis.HYPERDRIVE) as Hyperdrive | undefined
  // Use Hyperdrive if available (prod Cloudflare), otherwise DATABASE_URL
  return hyperdrive?.connectionString || runtimeConfig.databaseUrl
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
export const cacheClient = {
  get: async (key: string) => {
    const value = await kv.get(key)
    if (value == null) {
      return null
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    await kv.set(key, value, ttl ? { ttl } : undefined)
  },
  delete: async (key: string) => {
    await kv.del(key)
  }
}

let resendClient: Resend | undefined

// Email is optional: the Resend SDK throws without an API key, so the client
// is only created, on first use, when a key is configured.
export const getResendClient = () => {
  if (!resendClient && runtimeConfig.resendApiKey) {
    resendClient = new Resend(runtimeConfig.resendApiKey)
  }
  return resendClient
}
