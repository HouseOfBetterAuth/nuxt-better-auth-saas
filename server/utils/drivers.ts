import { kv } from 'hub:kv'
import Redis from 'ioredis'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

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

    const value = await kv.get(key)
    if (!value)
      return null
    return JSON.stringify(value)
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
