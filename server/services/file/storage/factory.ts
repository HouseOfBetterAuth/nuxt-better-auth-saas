import type { FileManagerConfig, StorageProvider } from '../types'
import { LocalStorageProvider } from './local'
import { S3CompatibleStorageProvider } from './s3-compatible'

type S3Config = NonNullable<FileManagerConfig['storage']['s3']>

// Settings the s3 provider cannot work without, with the runtime variable that sets each one
const S3_REQUIRED_SETTINGS: [keyof S3Config, string][] = [
  ['accessKeyId', 'NUXT_FILE_MANAGER_STORAGE_S3_ACCESS_KEY_ID'],
  ['secretAccessKey', 'NUXT_FILE_MANAGER_STORAGE_S3_SECRET_ACCESS_KEY'],
  ['bucketName', 'NUXT_FILE_MANAGER_STORAGE_S3_BUCKET_NAME']
]

function assertS3Config(s3: S3Config) {
  const missing = S3_REQUIRED_SETTINGS
    .filter(([key]) => !s3[key])
    .map(([, variable]) => variable)
  if (missing.length) {
    throw new Error(`S3 storage is missing ${missing.join(', ')}`)
  }
}

export async function createStorageProvider(config: FileManagerConfig['storage']): Promise<StorageProvider> {
  switch (config.provider) {
    case 'local':
      if (!config.local) {
        throw new Error('Local storage configuration is required')
      }
      return new LocalStorageProvider(config.local.uploadDir, config.local.publicPath)

    case 's3':
      if (!config.s3) {
        throw new Error('S3 storage configuration is required')
      }
      assertS3Config(config.s3)
      return new S3CompatibleStorageProvider({
        provider: 's3',
        ...config.s3
      })

    case 'r2':
      if (!config.r2) {
        throw new Error('R2 storage configuration is required')
      }
      return new S3CompatibleStorageProvider({
        provider: 'r2',
        ...config.r2
      })

    default:
      throw new Error(`Unsupported storage provider: ${config.provider}`)
  }
}
