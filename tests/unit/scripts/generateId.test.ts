import { describe, expect, it, vi } from 'vitest'

import { generateId } from '../../../scripts/troubleshoot-chat-anon-orgs'

describe('generateId', () => {
  it('throws if crypto.randomUUID is unavailable (requires Node 20+)', () => {
    vi.stubGlobal('crypto', {})
    expect(() => generateId()).toThrowError(/crypto\.randomUUID\(\) is not available\. Please use Node 20\+\./)
  })

  it('returns a UUID string when crypto.randomUUID is available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000000' })
    expect(generateId()).toBe('00000000-0000-4000-8000-000000000000')
  })
})
