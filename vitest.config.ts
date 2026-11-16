import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    testTimeout: 30000,
    // Unit tests run without Nuxt: pnpm test:unit (vitest.unit.config.ts)
    exclude: ['**/node_modules/**', 'tests/unit/**'],
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
