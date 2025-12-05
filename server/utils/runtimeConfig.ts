import type { NitroRuntimeConfig } from 'nitropack/types'
import type { FileManagerConfig, StorageProviderType } from '../services/file/types'
import { config } from 'dotenv'
import { getAppUrl } from '../../shared/utils/app-url'

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    fileManager: FileManagerConfig
  }
}

const parseDraftQuotaLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const DEFAULT_DRAFT_QUOTA = {
  anonymous: parseDraftQuotaLimit(process.env.NUXT_DRAFT_QUOTA_ANONYMOUS, 5),
  verified: parseDraftQuotaLimit(process.env.NUXT_DRAFT_QUOTA_VERIFIED, 25),
  paid: parseDraftQuotaLimit(process.env.NUXT_DRAFT_QUOTA_PAID, 0)
}

let runtimeConfigInstance: NitroRuntimeConfig

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
  databaseUrl: process.env.NUXT_DATABASE_URL,
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
    draftQuota: DEFAULT_DRAFT_QUOTA,
    auth: {
      redirectUserTo: '/',
      redirectGuestTo: '/signin'
    }
  }
})

if (typeof useRuntimeConfig !== 'undefined') {
  runtimeConfigInstance = useRuntimeConfig()
} else {
  // for cli: npm run auth:schema
  config()
  runtimeConfigInstance = generateRuntimeConfig() as NitroRuntimeConfig
}

export const runtimeConfig = runtimeConfigInstance
