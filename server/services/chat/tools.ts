import type {
  ChatCompletionToolCall,
  ChatCompletionToolDefinition
} from '~~/server/utils/aiGateway'

export type ToolKind = 'read' | 'write' | 'ingest'

export type ChatToolName = 'content_write' | 'edit_section' | 'source_ingest' | 'edit_metadata' | 'read_content' | 'read_section' | 'read_source' | 'read_content_list' | 'read_source_list' | 'read_workspace_summary'

export type ChatToolArguments<TName extends ChatToolName> =
  TName extends 'content_write'
    ? {
        action: 'create' | 'enrich'
        // For action='create':
        sourceContentId?: string | null
        sourceText?: string | null
        context?: string | null
        title?: string | null
        slug?: string | null
        status?: string | null
        primaryKeyword?: string | null
        targetLocale?: string | null
        contentType?: string | null
        systemPrompt?: string | null
        temperature?: number | null
        // For action='enrich':
        contentId?: string | null
        baseUrl?: string | null
      }
    : TName extends 'edit_section'
      ? {
          contentId: string
          sectionId?: string | null
          sectionTitle?: string | null
          instructions?: string | null
          temperature?: number | null
        }
      : TName extends 'source_ingest'
        ? {
            sourceType: 'youtube' | 'context'
            youtubeUrl?: string | null
            titleHint?: string | null
            context?: string | null
            title?: string | null
          }
        : TName extends 'edit_metadata'
          ? {
              contentId: string
              title?: string | null
              slug?: string | null
              status?: string | null
              primaryKeyword?: string | null
              targetLocale?: string | null
              contentType?: string | null
            }
          : TName extends 'read_content'
            ? {
                contentId: string
              }
            : TName extends 'read_section'
              ? {
                  contentId: string
                  sectionId: string
                }
              : TName extends 'read_source'
                ? {
                    sourceContentId: string
                  }
                : TName extends 'read_content_list'
                  ? {
                      status?: string | null
                      contentType?: string | null
                      limit?: number | null
                      offset?: number | null
                      orderBy?: 'updatedAt' | 'createdAt' | 'title' | null
                      orderDirection?: 'asc' | 'desc' | null
                    }
                  : TName extends 'read_source_list'
                    ? {
                        sourceType?: string | null
                        ingestStatus?: string | null
                        limit?: number | null
                        offset?: number | null
                        orderBy?: 'updatedAt' | 'createdAt' | 'title' | null
                        orderDirection?: 'asc' | 'desc' | null
                      }
                    : TName extends 'read_workspace_summary'
                      ? {
                          contentId: string
                        }
                      : never

export interface ChatToolInvocation<TName extends ChatToolName = ChatToolName> {
  name: TName
  arguments: ChatToolArguments<TName>
}

type ParameterSchema = Record<string, any>

interface ToolDefinition {
  kind: ToolKind
  definition: ChatCompletionToolDefinition
}

const chatToolDefinitions: Record<ChatToolName, ToolDefinition> = {
  content_write: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'content_write',
        description: 'Write or enrich content. Use action="create" to create new content from source (saved source content, inline text, or conversation history). Use action="enrich" to refresh an existing content item\'s frontmatter and JSON-LD structured data. For editing existing content sections, use edit_section. For updating metadata fields, use edit_metadata.',
        parameters: buildContentWriteParameters()
      }
    }
  },
  edit_section: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'edit_section',
        description: 'Edit a specific section of an existing content item using the user\'s instructions.',
        parameters: buildEditSectionParameters()
      }
    }
  },
  source_ingest: {
    kind: 'ingest',
    definition: {
      type: 'function',
      function: {
        name: 'source_ingest',
        description: 'Ingest source content from either a YouTube video or arbitrary context text. Use sourceType="youtube" to fetch captions from a YouTube video, or sourceType="context" to save pasted text as source content for content generation.',
        parameters: buildSourceIngestParameters()
      }
    }
  },
  edit_metadata: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'edit_metadata',
        description: 'Update metadata fields (title, slug, status, primaryKeyword, targetLocale, contentType) for an existing content item. Use this for simple edits like "make the title shorter", "change the status", or "update the slug". This tool patches the existing content without creating a new version.',
        parameters: buildEditMetadataParameters()
      }
    }
  },
  read_content: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_content',
        description: 'Fetch a content item and its current version for inspection. Returns content metadata, version info, and sections. This is a read-only operation.',
        parameters: buildReadContentParameters()
      }
    }
  },
  read_section: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_section',
        description: 'Fetch a specific section of a content item for inspection. Returns section text and metadata. This is a read-only operation.',
        parameters: buildReadSectionParameters()
      }
    }
  },
  read_source: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_source',
        description: 'Fetch a source content item (e.g. context) for inspection. Returns source content info including context text and chunk metadata. This is a read-only operation.',
        parameters: buildReadSourceParameters()
      }
    }
  },
  read_content_list: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_content_list',
        description: 'List content items with optional filtering. Returns a paginated list of content items with metadata. This is a read-only operation.',
        parameters: buildReadContentListParameters()
      }
    }
  },
  read_source_list: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_source_list',
        description: 'List source content items (YouTube videos, manual context, etc.) with optional filtering. Returns a paginated list of source content. This is a read-only operation.',
        parameters: buildReadSourceListParameters()
      }
    }
  },
  read_workspace_summary: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_workspace_summary',
        description: 'Get a formatted summary of a content workspace. Returns a human-readable summary of the content, its version, sections, and source. This is a read-only operation.',
        parameters: buildReadWorkspaceSummaryParameters()
      }
    }
  }
}

function buildContentWriteParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'enrich'],
        description: 'Action to perform: "create" to create new content from source, or "enrich" to refresh existing content\'s frontmatter and JSON-LD.'
      },
      // For action='create':
      sourceContentId: {
        type: ['string', 'null'],
        description: 'Source content ID to generate from (required for action="create" if no sourceText/context).'
      },
      sourceText: {
        type: ['string', 'null'],
        description: 'Inline source text to use directly for generation (for action="create"). If provided without sourceContentId, will create source content first.'
      },
      context: {
        type: ['string', 'null'],
        description: 'Alias for sourceText (for action="create"). Raw context text to use for generating content. If both sourceText and context are provided, sourceText takes precedence.'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional working title for the content item (for action="create").'
      },
      slug: {
        type: ['string', 'null'],
        description: 'Optional slug for the content item (for action="create").'
      },
      status: {
        type: ['string', 'null'],
        description: 'Desired content status (draft, review, published, etc.) (for action="create").'
      },
      primaryKeyword: {
        type: ['string', 'null'],
        description: 'Primary keyword for SEO (for action="create").'
      },
      targetLocale: {
        type: ['string', 'null'],
        description: 'Target locale (e.g., en-US) (for action="create").'
      },
      contentType: {
        type: ['string', 'null'],
        description: 'Content type identifier (blog_post, newsletter, etc.) (for action="create").'
      },
      systemPrompt: {
        type: ['string', 'null'],
        description: 'Custom system prompt overrides when the user provides style guidance (for action="create").'
      },
      temperature: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 2,
        description: 'Sampling temperature for creative control (default 1) (for action="create").'
      },
      // For action='enrich':
      contentId: {
        type: ['string', 'null'],
        description: 'Content ID of the content item to re-enrich (required for action="enrich").'
      },
      baseUrl: {
        type: ['string', 'null'],
        description: 'Optional base URL for generating absolute URLs in JSON-LD structured data (for action="enrich").'
      }
    },
    required: ['action']
  }
}

function buildEditSectionParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID containing the section that should be patched.'
      },
      sectionId: {
        type: ['string', 'null'],
        description: 'Unique identifier of the section to patch.'
      },
      sectionTitle: {
        type: ['string', 'null'],
        description: 'Human readable section title when no sectionId is present.'
      },
      instructions: {
        type: ['string', 'null'],
        description: 'User instructions describing the requested edits.'
      },
      temperature: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 2
      }
    },
    required: ['contentId']
  }
}

function buildSourceIngestParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceType: {
        type: 'string',
        enum: ['youtube', 'context'],
        description: 'Type of source to ingest. Use "youtube" to fetch captions from a YouTube video, or "context" to save pasted text as source content.'
      },
      youtubeUrl: {
        type: ['string', 'null'],
        description: 'YouTube video URL to ingest (required if sourceType="youtube"). Example: https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID.'
      },
      titleHint: {
        type: ['string', 'null'],
        description: 'Optional title hint for YouTube source content (only used when sourceType="youtube").'
      },
      context: {
        type: ['string', 'null'],
        description: 'Raw context text to save as source content (required if sourceType="context").'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional title for context source content (only used when sourceType="context").'
      }
    },
    required: ['sourceType']
  }
}

function buildEditMetadataParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID of the content item to update.'
      },
      title: {
        type: ['string', 'null'],
        description: 'New title for the content item.'
      },
      slug: {
        type: ['string', 'null'],
        description: 'New slug for the content item (will be auto-slugified).'
      },
      status: {
        type: ['string', 'null'],
        description: 'New status (draft, in_review, ready_for_publish, published, archived).'
      },
      primaryKeyword: {
        type: ['string', 'null'],
        description: 'New primary keyword for SEO.'
      },
      targetLocale: {
        type: ['string', 'null'],
        description: 'New target locale (e.g., en-US, es-ES).'
      },
      contentType: {
        type: ['string', 'null'],
        description: 'New content type (blog_post, newsletter, etc.).'
      }
    },
    required: ['contentId']
  }
}

function buildReadContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'ID of the content to read.'
      }
    },
    required: ['contentId']
  }
}

function buildReadSectionParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'ID of the content containing the section.'
      },
      sectionId: {
        type: 'string',
        description: 'ID of the section to read.'
      }
    },
    required: ['contentId', 'sectionId']
  }
}

function buildReadSourceParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceContentId: {
        type: 'string',
        description: 'ID of the source content to read.'
      }
    },
    required: ['sourceContentId']
  }
}

function buildReadContentListParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      status: {
        type: ['string', 'null'],
        description: 'Filter by content status (draft, in_review, ready_for_publish, published, archived).'
      },
      contentType: {
        type: ['string', 'null'],
        description: 'Filter by content type (blog_post, newsletter, etc.).'
      },
      limit: {
        type: ['number', 'null'],
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of items to return (default: 20, max: 100).'
      },
      offset: {
        type: ['number', 'null'],
        minimum: 0,
        description: 'Number of items to skip for pagination (default: 0).'
      },
      orderBy: {
        type: ['string', 'null'],
        enum: ['updatedAt', 'createdAt', 'title', null],
        description: 'Field to sort by (default: updatedAt).'
      },
      orderDirection: {
        type: ['string', 'null'],
        enum: ['asc', 'desc', null],
        description: 'Sort direction (default: desc).'
      }
    }
  }
}

function buildReadSourceListParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceType: {
        type: ['string', 'null'],
        description: 'Filter by source type (youtube, context, etc.).'
      },
      ingestStatus: {
        type: ['string', 'null'],
        description: 'Filter by ingest status (ingested, ingesting, failed, etc.).'
      },
      limit: {
        type: ['number', 'null'],
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of items to return (default: 20, max: 100).'
      },
      offset: {
        type: ['number', 'null'],
        minimum: 0,
        description: 'Number of items to skip for pagination (default: 0).'
      },
      orderBy: {
        type: ['string', 'null'],
        enum: ['updatedAt', 'createdAt', 'title', null],
        description: 'Field to sort by (default: updatedAt).'
      },
      orderDirection: {
        type: ['string', 'null'],
        enum: ['asc', 'desc', null],
        description: 'Sort direction (default: desc).'
      }
    }
  }
}

function buildReadWorkspaceSummaryParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'ID of the content workspace to summarize.'
      }
    },
    required: ['contentId']
  }
}

function safeParseArguments(input: string): Record<string, any> | null {
  try {
    return input ? JSON.parse(input) : {}
  } catch (error) {
    console.warn('Failed to parse tool call arguments', error)
    return null
  }
}

export function getChatToolDefinitions(): ChatCompletionToolDefinition[] {
  return Object.values(chatToolDefinitions).map(tool => tool.definition)
}

export function getToolKind(toolName: ChatToolName): ToolKind {
  return chatToolDefinitions[toolName]?.kind ?? 'write'
}

export function getToolsByKind(kind: ToolKind): ChatCompletionToolDefinition[] {
  return Object.entries(chatToolDefinitions)
    .filter(([_, tool]) => tool.kind === kind)
    .map(([_, tool]) => tool.definition)
}

/**
 * Checks if a tool is allowed in the given mode.
 * Chat mode only allows read tools; agent mode allows all tools.
 */
export function isToolAllowedInMode(toolName: ChatToolName, mode: 'chat' | 'agent'): boolean {
  const toolKind = getToolKind(toolName)

  // Enforce read-only in chat mode
  if (mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')) {
    return false
  }

  return true
}

/**
 * Generates the error message for when a tool is not available in chat mode.
 */
export function getModeEnforcementError(toolName: ChatToolName): string {
  return `Tool "${toolName}" is not available in chat mode (it can modify content or ingest new data). Switch to agent mode.`
}

export function parseChatToolCall(toolCall: ChatCompletionToolCall): ChatToolInvocation | null {
  const args = safeParseArguments(toolCall.function.arguments || '{}')
  if (!args) {
    return null
  }

  if (toolCall.function.name === 'content_write') {
    const { type: _omit, ...rest } = args
    const invocation = rest as ChatToolInvocation<'content_write'>['arguments']
    
    // Runtime validation for conditional requirements
    if (invocation.action === 'create') {
      const hasSource = !!(invocation.sourceContentId || invocation.sourceText || invocation.context)
      if (!hasSource) {
        console.error('[Tool Validation] content_write with action="create" requires at least one of: sourceContentId, sourceText, or context')
        return null
      }
    } else if (invocation.action === 'enrich') {
      if (!invocation.contentId) {
        console.error('[Tool Validation] content_write with action="enrich" requires contentId')
        return null
      }
    }
    
    return {
      name: 'content_write',
      arguments: invocation
    }
  }

  if (toolCall.function.name === 'edit_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_section',
      arguments: rest as ChatToolInvocation<'edit_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'source_ingest') {
    const { type: _omit, ...rest } = args
    const invocation = rest as ChatToolInvocation<'source_ingest'>['arguments']
    
    // Runtime validation for conditional requirements
    if (invocation.sourceType === 'youtube') {
      if (!invocation.youtubeUrl) {
        console.error('[Tool Validation] source_ingest with sourceType="youtube" requires youtubeUrl')
        return null
      }
    } else if (invocation.sourceType === 'context') {
      if (!invocation.context) {
        console.error('[Tool Validation] source_ingest with sourceType="context" requires context')
        return null
      }
    }
    
    return {
      name: 'source_ingest',
      arguments: invocation
    }
  }

  if (toolCall.function.name === 'edit_metadata') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_metadata',
      arguments: rest as ChatToolInvocation<'edit_metadata'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_content',
      arguments: rest as ChatToolInvocation<'read_content'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_section',
      arguments: rest as ChatToolInvocation<'read_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_source') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_source',
      arguments: rest as ChatToolInvocation<'read_source'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_content_list') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_content_list',
      arguments: rest as ChatToolInvocation<'read_content_list'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_source_list') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_source_list',
      arguments: rest as ChatToolInvocation<'read_source_list'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_workspace_summary') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_workspace_summary',
      arguments: rest as ChatToolInvocation<'read_workspace_summary'>['arguments']
    }
  }

  return null
}
