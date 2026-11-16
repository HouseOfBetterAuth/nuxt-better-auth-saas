import type { NitroRuntimeConfig } from 'nitropack/types'
import type { FileManagerConfig, StorageProviderType } from '~~/server/services/file/types'
import { config } from 'dotenv'

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    fileManager: FileManagerConfig
  }
}

let runtimeConfigInstance: NitroRuntimeConfig

/**
 * Runtime configuration.
 *
 * Values are still read from the variables below at build time, so existing
 * deployments keep working. Every key also has a defined default (`''` when
 * unset), so that it is kept in the built config and can be overridden when
 * the server starts by the variable Nuxt derives from its path: `NUXT_` + the
 * key path in
 * SCREAMING_SNAKE_CASE, e.g. `databaseUrl` -> `NUXT_DATABASE_URL`,
 * `public.baseURL` -> `NUXT_PUBLIC_BASE_URL`. A key left `undefined` is dropped
 * from the build output and can then never be set at runtime.
 * See .env.example for the full list.
 *
 * `preset` is the Nitro preset the server is built for (see nuxt.config.ts).
 */
export const generateRuntimeConfig = (preset = 'node-server') => ({
  preset,
  betterAuthSecret: process.env.NUXT_BETTER_AUTH_SECRET || '',
  // Stripe
  stripeSecretKey: process.env.NUXT_STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.NUXT_STRIPE_WEBHOOK_SECRET || '',

  // Resend
  resendApiKey: process.env.NUXT_RESEND_API_KEY || '',
  // Github
  githubClientId: process.env.NUXT_GH_CLIENT_ID || '',
  githubClientSecret: process.env.NUXT_GH_CLIENT_SECRET || '',
  // Google
  googleClientId: process.env.NUXT_GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.NUXT_GOOGLE_CLIENT_SECRET || '',
  // Google Maps
  googleMapsApiKey: process.env.NUXT_GOOGLE_MAPS_API_KEY || '',
  // DB
  redisUrl: process.env.NUXT_REDIS_URL || '',
  databaseUrl: process.env.DATABASE_URL || '',
  // File
  fileManager: {
    storage: {
      provider: process.env.NUXT_APP_STORAGE as StorageProviderType || 'r2',
      local: { // provider: 'local'
        uploadDir: process.env.NUXT_LOCAL_UPLOAD_DIR || './uploads',
        publicPath: process.env.NUXT_LOCAL_PUBLIC_PATH || '/uploads'
      },
      r2: { // provider: 'r2'
        accountId: process.env.NUXT_CF_ACCOUNT_ID || '',
        accessKeyId: process.env.NUXT_CF_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.NUXT_CF_SECRET_ACCESS_KEY || '',
        bucketName: process.env.NUXT_CF_R2_BUCKET_NAME || '',
        publicUrl: process.env.NUXT_CF_R2_PUBLIC_URL || ''
      },
      s3: { // provider: 's3', set at runtime with NUXT_FILE_MANAGER_STORAGE_S3_*
        region: '',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        publicUrl: ''
      }
    },
    uploadRateLimit: {
      maxUploadsPerWindow: 100,
      windowSizeMinutes: 1
    }
  } satisfies FileManagerConfig,
  public: {
    baseURL: process.env.NUXT_APP_URL || '',
    appName: process.env.NUXT_APP_NAME || '',
    appEnv: process.env.NODE_ENV || '',
    appRepo: process.env.NUXT_APP_REPO || '',
    appNotifyEmail: process.env.NUXT_APP_NOTIFY_EMAIL || '',
    appContactEmail: process.env.NUXT_APP_CONTACT_EMAIL || '',
    googleMapsApiKeyPublic: process.env.NUXT_GOOGLE_MAPS_API_KEY_PUBLIC || '',
    payment: process.env.NUXT_PAYMENT || 'stripe',
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
