import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    testTimeout: 30000,
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
        overrides: {
          vite: {
            resolve: {
              alias: {
                'hub:kv': fileURLToPath(new URL('./tests/utils/hub-kv.stub.ts', import.meta.url)),
                'hub:db': fileURLToPath(new URL('./tests/utils/hub-db.stub.ts', import.meta.url))
              }
            }
          },
          alias: {
            'hub:kv': fileURLToPath(new URL('./tests/utils/hub-kv.stub.ts', import.meta.url)),
            'hub:db': fileURLToPath(new URL('./tests/utils/hub-db.stub.ts', import.meta.url))
          },
          nitro: {
            alias: {
              'hub:kv': fileURLToPath(new URL('./tests/utils/hub-kv.stub.ts', import.meta.url)),
              'hub:db': fileURLToPath(new URL('./tests/utils/hub-db.stub.ts', import.meta.url))
            }
          }
        }
      }
    },
    coverage: {
      reporter: ['html'],
      reportsDirectory: '../tests/coverage'
    },
    setupFiles: './tests/setup.ts'
  }
})
