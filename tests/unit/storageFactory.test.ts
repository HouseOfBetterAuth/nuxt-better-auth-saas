import type { FileManagerConfig } from '~~/server/services/file/types'
import { describe, expect, it } from 'vitest'
import { createStorageProvider } from '~~/server/services/file/storage/factory'

const s3Storage = (s3: NonNullable<FileManagerConfig['storage']['s3']>): FileManagerConfig['storage'] => ({
  provider: 's3',
  s3
})

const completeS3 = {
  region: 'eu-west-3',
  endpoint: '',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  bucketName: 'uploads',
  publicUrl: ''
}

describe('createStorageProvider', () => {
  it('creates the s3 provider when its settings are complete', async () => {
    const provider = await createStorageProvider(s3Storage(completeS3))

    expect(provider.name).toBe('s3')
  })

  it('names the runtime variables an s3 setup is missing', async () => {
    await expect(createStorageProvider(s3Storage({ ...completeS3, accessKeyId: '', bucketName: '' })))
      .rejects
      .toThrow('S3 storage is missing NUXT_FILE_MANAGER_STORAGE_S3_ACCESS_KEY_ID, NUXT_FILE_MANAGER_STORAGE_S3_BUCKET_NAME')
  })
})
