import { describe, expect, it } from 'vitest'
import { isAnonymousWorkspaceConversationRoute, stripLocalePrefix } from '~~/shared/utils/routeMatching'

describe('routeMatching', () => {
  describe('stripLocalePrefix', () => {
    it('does nothing when no locale prefix exists', () => {
      expect(stripLocalePrefix('/anonymous-workspace/conversations', ['en'])).toBe('/anonymous-workspace/conversations')
    })

    it('strips a simple locale prefix', () => {
      expect(stripLocalePrefix('/en/anonymous-workspace/conversations', ['en', 'fr'])).toBe('/anonymous-workspace/conversations')
    })

    it('strips a complex locale prefix (e.g. en-US)', () => {
      expect(stripLocalePrefix('/en-US/anonymous-workspace/conversations', ['en-US', 'fr'])).toBe('/anonymous-workspace/conversations')
    })
  })

  describe('isAnonymousWorkspaceConversationRoute', () => {
    it('matches anonymous workspace conversations without locale prefix', () => {
      expect(isAnonymousWorkspaceConversationRoute('/anonymous-workspace/conversations', ['en'])).toBe(true)
      expect(isAnonymousWorkspaceConversationRoute('/anonymous-123/conversations/abc', ['en'])).toBe(true)
    })

    it('matches anonymous workspace conversations with locale prefix', () => {
      expect(isAnonymousWorkspaceConversationRoute('/en/anonymous-workspace/conversations', ['en', 'fr'])).toBe(true)
      expect(isAnonymousWorkspaceConversationRoute('/en-US/anonymous-workspace/conversations', ['en-US'])).toBe(true)
    })

    it('does not match non-anonymous workspace conversations', () => {
      expect(isAnonymousWorkspaceConversationRoute('/my-org/conversations', ['en'])).toBe(false)
      expect(isAnonymousWorkspaceConversationRoute('/en/my-org/conversations', ['en'])).toBe(false)
    })
  })
})
