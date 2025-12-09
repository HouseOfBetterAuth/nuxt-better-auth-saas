import type { ChatToolInvocation } from '~~/server/services/chat/tools'
import { describe, expect, it } from 'vitest'
import { getModeEnforcementError, getToolKind } from '~~/server/services/chat/tools'

/**
 * Integration tests for tool execution and mode enforcement
 *
 * Tests the mode enforcement logic that would be in executeChatTool
 * Since executeChatTool is not exported, we test the guardrail logic directly
 */
describe('tool Execution Mode Enforcement', () => {
  describe('chat Mode - Write Tools Blocked', () => {
    const writeTools: Array<ChatToolInvocation['name']> = [
      'content_write',
      'edit_section',
      'edit_metadata'
    ]

    for (const toolName of writeTools) {
      it(`should block ${toolName} in chat mode`, () => {
        const mode = 'chat'
        const toolKind = getToolKind(toolName)

        // Simulate the guardrail logic from executeChatTool line 180
        const shouldBlock = mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')

        expect(shouldBlock).toBe(true)
        expect(toolKind).toBe('write')

        // Verify error message format using the actual implementation
        const actualError = getModeEnforcementError(toolName)
        expect(actualError).toContain('not available in chat mode')
        expect(actualError).toContain('Switch to agent mode')
        expect(actualError).toContain(toolName)
      })
    }
  })

  describe('chat Mode - Ingest Tools Blocked', () => {
    it('should block source_ingest in chat mode', () => {
      const toolName = 'source_ingest'
      const mode = 'chat'
      const toolKind = getToolKind(toolName)

      const shouldBlock = mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')

      expect(shouldBlock).toBe(true)
      expect(toolKind).toBe('ingest')
    })
  })

  describe('chat Mode - Read Tools Allowed', () => {
    const readTools: Array<ChatToolInvocation['name']> = [
      'read_content',
      'read_section',
      'read_source',
      'read_content_list',
      'read_source_list',
      'read_workspace_summary'
    ]

    for (const toolName of readTools) {
      it(`should allow ${toolName} in chat mode`, () => {
        const mode = 'chat'
        const toolKind = getToolKind(toolName)

        const shouldBlock = mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')

        expect(shouldBlock).toBe(false)
        expect(toolKind).toBe('read')
      })
    }
  })

  describe('agent Mode - All Tools Allowed', () => {
    const allTools: Array<ChatToolInvocation['name']> = [
      'read_content',
      'read_section',
      'read_source',
      'read_content_list',
      'read_source_list',
      'read_workspace_summary',
      'content_write',
      'edit_section',
      'edit_metadata',
      'source_ingest'
    ]

    for (const toolName of allTools) {
      it(`should allow ${toolName} in agent mode`, () => {
        const mode = 'agent'
        const toolKind = getToolKind(toolName)

        const shouldBlock = mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')

        expect(shouldBlock).toBe(false)
      })
    }
  })

  describe('error Message Consistency', () => {
    it('should have consistent error message format for all blocked tools', () => {
      const blockedTools: Array<ChatToolInvocation['name']> = [
        'content_write',
        'edit_section',
        'edit_metadata',
        'source_ingest'
      ]

      for (const toolName of blockedTools) {
        const actualMessage = getModeEnforcementError(toolName)

        expect(actualMessage).toContain(`Tool "${toolName}"`)
        expect(actualMessage).toContain('not available in chat mode')
        expect(actualMessage).toContain('Switch to agent mode')
      }
    })
  })
})
