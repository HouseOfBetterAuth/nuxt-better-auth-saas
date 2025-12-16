import type { NitroRuntimeConfig } from 'nitropack/types'
import type { FileManagerConfig, StorageProviderType } from '~~/server/services/file/types'
import { config } from 'dotenv'

// Inline getAppUrl to avoid import issues during config time
const LOOPBACK_HOSTS = new Set(['localhost', '::1'])
const INVALID_PRODUCTION_HOSTS = new Set(['0.0.0.0'])
const IPV4_LOOPBACK_REGEX = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const isInvalidProductionHostname = (hostname: string) => {
  return LOOPBACK_HOSTS.has(hostname) || INVALID_PRODUCTION_HOSTS.has(hostname) || IPV4_LOOPBACK_REGEX.test(hostname)
}

const assertValidProductionUrl = (value: string) => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`NUXT_APP_URL must be a valid absolute URL. Received: ${value}`)
  }

  if (isInvalidProductionHostname(parsed.hostname)) {
    throw new Error('NUXT_APP_URL cannot be a localhost/loopback/wildcard address in production.')
  }
}

const getAppUrl = (): string => {
  const nodeEnv = process.env.NODE_ENV || 'development'

  if (nodeEnv === 'test') {
    return process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'
  }

  if (nodeEnv === 'production') {
    // In production, use NUXT_APP_URL (should be https://getquillio.com)
    // Fallback to getquillio.com if not set (though it should always be set)
    const url = process.env.NUXT_APP_URL || 'https://getquillio.com'
    assertValidProductionUrl(url)
    return url
  }

  // In development, always use localhost:3000 regardless of NUXT_APP_URL
  // This ensures OAuth callbacks work correctly in local development
  return 'http://localhost:3000'
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    fileManager: FileManagerConfig
  }
}

let runtimeConfigInstance: NitroRuntimeConfig | null = null
let _resolvedFromNuxt = false
let _resolvedFromEnv = false
let dotenvLoaded = false

const callUseRuntimeConfig = () => (useRuntimeConfig as () => NitroRuntimeConfig)()

const tryResolveFromNuxt = () => {
  if (_resolvedFromNuxt || typeof useRuntimeConfig === 'undefined') {
    return false
  }

  try {
    runtimeConfigInstance = callUseRuntimeConfig()
    _resolvedFromNuxt = true
    _resolvedFromEnv = false
    return true
  } catch {
    return false
  }
}

export const generateRuntimeConfig = () => ({
  preset: process.env.NUXT_NITRO_PRESET,
  betterAuthSecret: process.env.NUXT_BETTER_AUTH_SECRET,
  // Feature Flags
  enableYoutubeIngestion: process.env.NUXT_ENABLE_YOUTUBE_INGESTION !== 'false',
  // LLM / Cloudflare AI Gateway
  cfAccountId: process.env.NUXT_CF_ACCOUNT_ID,
  cfAiGatewayToken: process.env.NUXT_CF_AI_GATEWAY_TOKEN,
  cfVectorizeIndex: process.env.NUXT_CF_VECTORIZE_INDEX,
  cfVectorizeApiToken: process.env.NUXT_CF_VECTORIZE_API_TOKEN,
  cfEmbedModel: process.env.NUXT_CF_EMBED_MODEL || '@cf/baai/bge-base-en-v1.5',
  openAiApiKey: process.env.NUXT_OPENAI_API_KEY,
  openAiBlogModel: process.env.NUXT_OPENAI_BLOG_MODEL,
  openAiBlogTemperature: (() => {
    const parsed = Number.parseFloat(process.env.NUXT_OPENAI_BLOG_TEMPERATURE ?? '')
    return Number.isFinite(parsed) ? parsed : 0.7
  })(),
  openAiBlogMaxOutputTokens: (() => {
    const parsed = Number.parseInt(process.env.NUXT_OPENAI_BLOG_MAX_OUTPUT_TOKENS ?? '', 10)
    return Number.isFinite(parsed) ? parsed : 1000
  })(),
  // Stripe
  stripeSecretKey: process.env.NUXT_STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.NUXT_STRIPE_WEBHOOK_SECRET,

  // Resend
  resendApiKey: process.env.NUXT_RESEND_API_KEY,
  // Github
  githubClientId: process.env.NUXT_GH_CLIENT_ID,
  githubClientSecret: process.env.NUXT_GH_CLIENT_SECRET,
  // Google
  googleClientId: process.env.NUXT_GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.NUXT_GOOGLE_CLIENT_SECRET,
  // Worker API
  workerApiUrl: process.env.WORKER_API_URL || 'https://api-service.getquillio.com',
  // DB
  redisUrl: process.env.NUXT_REDIS_URL,
  databaseUrl: process.env.DATABASE_URL,
  // File
  fileManager: {
    storage: {
      provider: process.env.NUXT_APP_STORAGE as StorageProviderType || 'r2',
      local: { // provider: 'local'
        uploadDir: process.env.NUXT_LOCAL_UPLOAD_DIR || './uploads',
        publicPath: process.env.NUXT_LOCAL_PUBLIC_PATH || '/uploads'
      },
      r2: { // provider: 'r2'
        accountId: process.env.NUXT_CF_ACCOUNT_ID!,
        accessKeyId: process.env.NUXT_CF_ACCESS_KEY_ID!,
        secretAccessKey: process.env.NUXT_CF_SECRET_ACCESS_KEY!,
        bucketName: process.env.NUXT_CF_R2_BUCKET_NAME!,
        publicUrl: process.env.NUXT_CF_R2_PUBLIC_URL!
      }
    },
    uploadRateLimit: {
      maxUploadsPerWindow: 100,
      windowSizeMinutes: 1
    }
  } satisfies FileManagerConfig,
  public: {
    baseURL: getAppUrl(),
    appName: process.env.NUXT_APP_NAME,
    appEnv: process.env.NODE_ENV,
    appRepo: process.env.NUXT_APP_REPO,
    appNotifyEmail: process.env.NUXT_APP_NOTIFY_EMAIL,
    appContactEmail: process.env.NUXT_APP_CONTACT_EMAIL,
    payment: process.env.NUXT_PAYMENT || 'stripe',
    auth: {
      redirectUserTo: '/',
      redirectGuestTo: '/signin'
    }
  }
})

const resolveRuntimeConfig = () => {
  if (!runtimeConfigInstance && tryResolveFromNuxt()) {
    return runtimeConfigInstance
  }

  if (runtimeConfigInstance && !_resolvedFromNuxt) {
    if (tryResolveFromNuxt()) {
      return runtimeConfigInstance
    }
  }

  if (!runtimeConfigInstance) {
    // CLI or early usage before Nuxt initializes - fall back to env config
    if (!dotenvLoaded) {
      config()
      dotenvLoaded = true
    }
    runtimeConfigInstance = generateRuntimeConfig() as NitroRuntimeConfig
    _resolvedFromEnv = true
  }

  return runtimeConfigInstance
}

export const runtimeConfig = new Proxy({} as NitroRuntimeConfig, {
  get(_, prop) {
    const instance = resolveRuntimeConfig()
    return (instance as any)[prop]
  },
  set(_, prop, value) {
    const instance = resolveRuntimeConfig()
    ;(instance as any)[prop] = value
    return true
  },
  has(_, prop) {
    const instance = resolveRuntimeConfig()
    return prop in instance
  },
  ownKeys() {
    const instance = resolveRuntimeConfig()
    return Reflect.ownKeys(instance)
  },
  getOwnPropertyDescriptor(_, prop) {
    const instance = resolveRuntimeConfig()
    return Object.getOwnPropertyDescriptor(instance, prop as any)
  }
})
