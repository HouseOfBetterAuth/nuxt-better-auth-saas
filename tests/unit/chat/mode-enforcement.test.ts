import type { ChatToolName } from '~~/server/services/chat/tools'
import { describe, expect, it } from 'vitest'
import { getChatToolDefinitions, getModeEnforcementError, getToolsByKind, isToolAllowedInMode } from '~~/server/services/chat/tools'

// Test the actual mode enforcement implementation exported from the tools module

describe('mode Enforcement - Tool Selection', () => {
  describe('getToolsByKind for chat mode', () => {
    it('should return only read tools for chat mode', () => {
      const readTools = getToolsByKind('read')
      const toolNames = readTools.map(t => t.function.name)

      // Should have exactly 6 read tools
      expect(readTools).toHaveLength(6)

      // Should not include any write or ingest tools
      expect(toolNames).not.toContain('content_write')
      expect(toolNames).not.toContain('edit_section')
      expect(toolNames).not.toContain('edit_metadata')
      expect(toolNames).not.toContain('source_ingest')
    })

    it('should return all tools for agent mode', () => {
      const allTools = getChatToolDefinitions()
      const toolNames = allTools.map(t => t.function.name)

      // Should have all 10 tools
      expect(allTools).toHaveLength(10)

      // Should include read, write, and ingest tools
      expect(toolNames).toContain('read_content')
      expect(toolNames).toContain('content_write')
      expect(toolNames).toContain('source_ingest')
    })
  })
})

describe('mode Enforcement - Execution Guardrails', () => {
  // Test the actual mode enforcement implementation exported from the tools module

  describe('chat mode blocks write tools', () => {
    it('should block content_write in chat mode', () => {
      expect(isToolAllowedInMode('content_write', 'chat')).toBe(false)
    })

    it('should block edit_section in chat mode', () => {
      expect(isToolAllowedInMode('edit_section', 'chat')).toBe(false)
    })

    it('should block edit_metadata in chat mode', () => {
      expect(isToolAllowedInMode('edit_metadata', 'chat')).toBe(false)
    })

    it('should block source_ingest in chat mode', () => {
      expect(isToolAllowedInMode('source_ingest', 'chat')).toBe(false)
    })
  })

  describe('chat mode allows read tools', () => {
    const readTools: ChatToolName[] = [
      'read_content',
      'read_section',
      'read_source',
      'read_content_list',
      'read_source_list',
      'read_workspace_summary'
    ]

    for (const toolName of readTools) {
      it(`should allow ${toolName} in chat mode`, () => {
        expect(isToolAllowedInMode(toolName, 'chat')).toBe(true)
      })
    }
  })

  describe('agent mode allows all tools', () => {
    const allTools: ChatToolName[] = [
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
        expect(isToolAllowedInMode(toolName, 'agent')).toBe(true)
      })
    }
  })

  describe('error message consistency', () => {
    it('should generate consistent error message format for blocked tools', () => {
      const toolName: ChatToolName = 'content_write'

      // Verify the tool is blocked in chat mode
      expect(isToolAllowedInMode(toolName, 'chat')).toBe(false)

      // Get the actual error message from the implementation
      const actualMessage = getModeEnforcementError(toolName)

      // Verify the message format matches what executeChatTool uses
      expect(actualMessage).toContain('not available in chat mode')
      expect(actualMessage).toContain('Switch to agent mode')
      expect(actualMessage).toContain(toolName)
      expect(actualMessage).toContain('can modify content or ingest new data')
    })

    it('should generate error messages for all blocked tools', () => {
      const blockedTools: ChatToolName[] = ['content_write', 'edit_section', 'edit_metadata', 'source_ingest']

      for (const toolName of blockedTools) {
        const errorMessage = getModeEnforcementError(toolName)
        expect(errorMessage).toContain(toolName)
        expect(errorMessage).toContain('not available in chat mode')
        expect(errorMessage).toContain('Switch to agent mode')
      }
    })
  })
})
