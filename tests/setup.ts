import { afterAll, beforeAll } from 'vitest'
import { closeSharedDbPool } from './utils/dbPool'

beforeAll(() => {
  // Global setup code can be added here
})

// Clean up shared database pool after all tests
afterAll(async () => {
  await closeSharedDbPool()
})
