import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateRuntimeConfig } from '~~/server/utils/runtimeConfig'

// Variables read by generateRuntimeConfig() at build time. They are cleared so
// that a local .env or shell export cannot change the outcome of these tests.
const BUILD_ENV = [
  'NODE_ENV',
  'NUXT_FORCE_CLOUDFLARE_DEV',
  'NUXT_NITRO_PRESET',
  'NUXT_BETTER_AUTH_SECRET',
  'NUXT_STRIPE_SECRET_KEY',
  'NUXT_STRIPE_WEBHOOK_SECRET',
  'NUXT_RESEND_API_KEY',
  'NUXT_GH_CLIENT_ID',
  'NUXT_GH_CLIENT_SECRET',
  'NUXT_GOOGLE_CLIENT_ID',
  'NUXT_GOOGLE_CLIENT_SECRET',
  'NUXT_GOOGLE_MAPS_API_KEY',
  'NUXT_REDIS_URL',
  'DATABASE_URL',
  'NUXT_APP_STORAGE',
  'NUXT_LOCAL_UPLOAD_DIR',
  'NUXT_LOCAL_PUBLIC_PATH',
  'NUXT_CF_ACCOUNT_ID',
  'NUXT_CF_ACCESS_KEY_ID',
  'NUXT_CF_SECRET_ACCESS_KEY',
  'NUXT_CF_R2_BUCKET_NAME',
  'NUXT_CF_R2_PUBLIC_URL',
  'NUXT_APP_URL',
  'NUXT_APP_NAME',
  'NUXT_APP_REPO',
  'NUXT_APP_NOTIFY_EMAIL',
  'NUXT_APP_CONTACT_EMAIL',
  'NUXT_GOOGLE_MAPS_API_KEY_PUBLIC',
  'NUXT_PAYMENT'
]

// Paths of the values that end up `undefined`. Nuxt serializes the runtime
// config into the server bundle as JSON, which drops them, and Nitro only
// applies NUXT_* overrides to keys that exist: such a key can then never be
// set at runtime.
const undefinedPaths = (value: unknown, path = ''): string[] => {
  if (value === undefined)
    return [path]
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return []
  return Object.entries(value).flatMap(([key, child]) =>
    undefinedPaths(child, path ? `${path}.${key}` : key))
}

describe('generateRuntimeConfig', () => {
  beforeEach(() => {
    for (const name of BUILD_ENV)
      vi.stubEnv(name, undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('declares every key with a defined default when nothing is set at build', () => {
    expect(undefinedPaths(generateRuntimeConfig())).toEqual([])
  })

  it('declares the s3 storage settings so they can be set at runtime', () => {
    expect(generateRuntimeConfig().fileManager.storage.s3).toEqual({
      region: '',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucketName: '',
      publicUrl: ''
    })
  })

  it('defaults the preset to node-server', () => {
    expect(generateRuntimeConfig().preset).toBe('node-server')
  })

  it('keeps the preset chosen for the build', () => {
    expect(generateRuntimeConfig('cloudflare-module').preset).toBe('cloudflare-module')
  })

  it('still reads the legacy variables at build time', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://build-db')
    vi.stubEnv('NUXT_GH_CLIENT_ID', 'build-gh-id')
    vi.stubEnv('NUXT_GH_CLIENT_SECRET', 'build-gh-secret')
    vi.stubEnv('NUXT_APP_URL', 'https://build.example.test')
    vi.stubEnv('NUXT_APP_STORAGE', 'local')
    vi.stubEnv('NUXT_CF_ACCOUNT_ID', 'build-account')
    vi.stubEnv('NUXT_PAYMENT', 'none')

    const config = generateRuntimeConfig()

    expect(config.databaseUrl).toBe('postgres://build-db')
    expect(config.githubClientId).toBe('build-gh-id')
    expect(config.githubClientSecret).toBe('build-gh-secret')
    expect(config.public.baseURL).toBe('https://build.example.test')
    expect(config.fileManager.storage.provider).toBe('local')
    expect(config.fileManager.storage.r2.accountId).toBe('build-account')
    expect(config.public.payment).toBe('none')
  })
})
