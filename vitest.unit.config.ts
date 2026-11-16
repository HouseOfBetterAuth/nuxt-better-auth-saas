import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for server code, run in plain Node without booting Nuxt.
// The e2e suite (tests/e2e) keeps using vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('./', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts']
  }
})
