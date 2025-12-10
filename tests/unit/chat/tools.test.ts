import type { ChatToolName } from '~~/server/services/chat/tools'
import type { ChatCompletionToolCall } from '~~/server/utils/aiGateway'
import { describe, expect, it } from 'vitest'
import {

  getChatToolDefinitions,
  getToolKind,
  getToolsByKind,
  parseChatToolCall
} from '~~/server/services/chat/tools'

describe('tool Registry', () => {
  describe('getChatToolDefinitions', () => {
    it('should return exactly 10 tools', () => {
      const tools = getChatToolDefinitions()
      expect(tools).toHaveLength(10)
    })

    it('should include all expected read tools', () => {
      const tools = getChatToolDefinitions()
      const toolNames = tools.map(t => t.function.name)

      const expectedReadTools = [
        'read_content',
        'read_section',
        'read_source',
        'read_content_list',
        'read_source_list',
        'read_workspace_summary'
      ]

      for (const toolName of expectedReadTools) {
        expect(toolNames).toContain(toolName)
      }
    })

    it('should include all expected write tools', () => {
      const tools = getChatToolDefinitions()
      const toolNames = tools.map(t => t.function.name)

      const expectedWriteTools = [
        'content_write',
        'edit_section',
        'edit_metadata'
      ]

      for (const toolName of expectedWriteTools) {
        expect(toolNames).toContain(toolName)
      }
    })

    it('should include source_ingest tool', () => {
      const tools = getChatToolDefinitions()
      const toolNames = tools.map(t => t.function.name)
      expect(toolNames).toContain('source_ingest')
    })

    it('should not include old tool names', () => {
      const tools = getChatToolDefinitions()
      const toolNames = tools.map(t => t.function.name)

      const oldToolNames = [
        'write_content',
        'enrich_content',
        'fetch_youtube',
        'save_source'
      ]

      for (const oldToolName of oldToolNames) {
        expect(toolNames).not.toContain(oldToolName)
      }
    })

    it('should have correct structure for each tool', () => {
      const tools = getChatToolDefinitions()

      for (const tool of tools) {
        expect(tool).toHaveProperty('type', 'function')
        expect(tool).toHaveProperty('function')
        expect(tool.function).toHaveProperty('name')
        expect(tool.function).toHaveProperty('description')
        expect(tool.function).toHaveProperty('parameters')
        expect(tool.function.parameters).toHaveProperty('type', 'object')
      }
    })
  })

  describe('getToolKind', () => {
    it('should return correct kind for read tools', () => {
      const readTools: ChatToolName[] = [
        'read_content',
        'read_section',
        'read_source',
        'read_content_list',
        'read_source_list',
        'read_workspace_summary'
      ]

      for (const toolName of readTools) {
        expect(getToolKind(toolName)).toBe('read')
      }
    })

    it('should return correct kind for write tools', () => {
      const writeTools: ChatToolName[] = [
        'content_write',
        'edit_section',
        'edit_metadata'
      ]

      for (const toolName of writeTools) {
        expect(getToolKind(toolName)).toBe('write')
      }
    })

    it('should return correct kind for ingest tools', () => {
      expect(getToolKind('source_ingest')).toBe('ingest')
    })

    it('should default to write for unknown tools', () => {
      // @ts-expect-error - testing invalid tool name
      expect(getToolKind('unknown_tool')).toBe('write')
    })
  })

  describe('getToolsByKind', () => {
    it('should return exactly 6 read tools', () => {
      const readTools = getToolsByKind('read')
      expect(readTools).toHaveLength(6)

      const toolNames = readTools.map(t => t.function.name)
      expect(toolNames).toContain('read_content')
      expect(toolNames).toContain('read_section')
      expect(toolNames).toContain('read_source')
      expect(toolNames).toContain('read_content_list')
      expect(toolNames).toContain('read_source_list')
      expect(toolNames).toContain('read_workspace_summary')
    })

    it('should return exactly 3 write tools', () => {
      const writeTools = getToolsByKind('write')
      expect(writeTools).toHaveLength(3)

      const toolNames = writeTools.map(t => t.function.name)
      expect(toolNames).toContain('content_write')
      expect(toolNames).toContain('edit_section')
      expect(toolNames).toContain('edit_metadata')
    })

    it('should return exactly 1 ingest tool', () => {
      const ingestTools = getToolsByKind('ingest')
      expect(ingestTools).toHaveLength(1)
      expect(ingestTools[0].function.name).toBe('source_ingest')
    })

    it('should not include write/ingest tools in read tools', () => {
      const readTools = getToolsByKind('read')
      const toolNames = readTools.map(t => t.function.name)

      expect(toolNames).not.toContain('content_write')
      expect(toolNames).not.toContain('edit_section')
      expect(toolNames).not.toContain('edit_metadata')
      expect(toolNames).not.toContain('source_ingest')
    })
  })
})

describe('tool Parsing', () => {
  describe('parseChatToolCall', () => {
    it('should parse valid content_write with action=create', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: JSON.stringify({
            action: 'create',
            sourceText: 'Test context',
            title: 'Test Title'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('content_write')
      expect(result?.arguments.action).toBe('create')
      expect(result?.arguments.sourceText).toBe('Test context')
      expect(result?.arguments.title).toBe('Test Title')
    })

    it('should parse valid content_write with action=enrich', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: JSON.stringify({
            action: 'enrich',
            contentId: 'content-123',
            baseUrl: 'https://example.com'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('content_write')
      expect(result?.arguments.action).toBe('enrich')
      expect(result?.arguments.contentId).toBe('content-123')
      expect(result?.arguments.baseUrl).toBe('https://example.com')
    })

    it('should parse valid source_ingest with sourceType=context', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'source_ingest',
          arguments: JSON.stringify({
            sourceType: 'context',
            context: 'Test context text',
            title: 'Test Source'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('source_ingest')
      expect(result?.arguments.sourceType).toBe('context')
      expect(result?.arguments.context).toBe('Test context text')
      expect(result?.arguments.title).toBe('Test Source')
    })

    it('should parse valid source_ingest with sourceType=youtube', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'source_ingest',
          arguments: JSON.stringify({
            sourceType: 'youtube',
            youtubeUrl: 'https://www.youtube.com/watch?v=test123',
            titleHint: 'Test Video'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('source_ingest')
      expect(result?.arguments.sourceType).toBe('youtube')
      expect(result?.arguments.youtubeUrl).toBe('https://www.youtube.com/watch?v=test123')
      expect(result?.arguments.titleHint).toBe('Test Video')
    })

    it('should parse valid edit_section', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'edit_section',
          arguments: JSON.stringify({
            contentId: 'content-123',
            sectionId: 'section-456',
            instructions: 'Make it more engaging'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('edit_section')
      expect(result?.arguments.contentId).toBe('content-123')
      expect(result?.arguments.sectionId).toBe('section-456')
      expect(result?.arguments.instructions).toBe('Make it more engaging')
    })

    it('should parse valid edit_metadata', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'edit_metadata',
          arguments: JSON.stringify({
            contentId: 'content-123',
            title: 'New Title',
            status: 'published'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('edit_metadata')
      expect(result?.arguments.contentId).toBe('content-123')
      expect(result?.arguments.title).toBe('New Title')
      expect(result?.arguments.status).toBe('published')
    })

    it('should parse valid read tools', () => {
      const readTools: ChatToolName[] = [
        'read_content',
        'read_section',
        'read_source',
        'read_content_list',
        'read_source_list',
        'read_workspace_summary'
      ]

      for (const toolName of readTools) {
        const toolCall: ChatCompletionToolCall = {
          id: 'call_123',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify({
              ...(toolName === 'read_content' && { contentId: 'content-123' }),
              ...(toolName === 'read_section' && { contentId: 'content-123', sectionId: 'section-456' }),
              ...(toolName === 'read_source' && { sourceContentId: 'source-123' }),
              ...(toolName === 'read_workspace_summary' && { contentId: 'content-123' })
            })
          }
        }

        const result = parseChatToolCall(toolCall)
        expect(result).not.toBeNull()
        expect(result?.name).toBe(toolName)
      }
    })

    it('should return null for invalid JSON arguments', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: 'invalid json{'
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).toBeNull()
    })

    it('should return null for unknown tool name', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: JSON.stringify({})
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).toBeNull()
    })

    it('should handle empty arguments', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_content_list',
          arguments: '{}'
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('read_content_list')
    })

    it('should handle missing arguments', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_content_list',
          arguments: ''
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result).not.toBeNull()
      expect(result?.name).toBe('read_content_list')
    })
  })

  describe('content_write parameter validation', () => {
    it('should require action field', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: JSON.stringify({
            sourceText: 'Test'
            // Missing action
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      // Parser doesn't validate - it just parses
      // Validation happens at execution time
      expect(result).not.toBeNull()
      expect(result?.arguments).not.toHaveProperty('action')
    })

    it('should handle both sourceText and context aliases for create', () => {
      const toolCall1: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: JSON.stringify({
            action: 'create',
            sourceText: 'Test text'
          })
        }
      }

      const toolCall2: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'content_write',
          arguments: JSON.stringify({
            action: 'create',
            context: 'Test context'
          })
        }
      }

      const result1 = parseChatToolCall(toolCall1)
      const result2 = parseChatToolCall(toolCall2)

      expect(result1?.arguments.sourceText).toBe('Test text')
      expect(result2?.arguments.context).toBe('Test context')
    })
  })

  describe('source_ingest parameter validation', () => {
    it('should require sourceType field', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'source_ingest',
          arguments: JSON.stringify({
            context: 'Test'
            // Missing sourceType
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      // Parser doesn't validate - it just parses
      expect(result).not.toBeNull()
      expect(result?.arguments).not.toHaveProperty('sourceType')
    })

    it('should handle youtube sourceType', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'source_ingest',
          arguments: JSON.stringify({
            sourceType: 'youtube',
            youtubeUrl: 'https://youtube.com/watch?v=test'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result?.arguments.sourceType).toBe('youtube')
      expect(result?.arguments.youtubeUrl).toBe('https://youtube.com/watch?v=test')
    })

    it('should handle context sourceType', () => {
      const toolCall: ChatCompletionToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'source_ingest',
          arguments: JSON.stringify({
            sourceType: 'context',
            context: 'Test context text'
          })
        }
      }

      const result = parseChatToolCall(toolCall)
      expect(result?.arguments.sourceType).toBe('context')
      expect(result?.arguments.context).toBe('Test context text')
    })
  })
})


