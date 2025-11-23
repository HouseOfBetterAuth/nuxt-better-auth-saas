import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    testTimeout: 30000,
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
        overrides: {
          // other Nuxt config you want to pass
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
