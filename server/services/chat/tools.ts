import type {
  ChatCompletionToolCall,
  ChatCompletionToolDefinition
} from '~~/server/utils/aiGateway'

export type ToolKind = 'read' | 'write' | 'ingest'

export type ChatToolName = 'write_content' | 'edit_section' | 'fetch_youtube' | 'save_source' | 'edit_metadata' | 'enrich_content' | 'read_content' | 'read_section' | 'read_source'

export type ChatToolArguments<TName extends ChatToolName> =
  TName extends 'write_content'
    ? {
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
      }
    : TName extends 'edit_section'
      ? {
          contentId: string
          sectionId?: string | null
          sectionTitle?: string | null
          instructions?: string | null
          temperature?: number | null
        }
      : TName extends 'fetch_youtube'
        ? {
            youtubeUrl: string
            titleHint?: string | null
          }
        : TName extends 'save_source'
          ? {
              context: string
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
            : TName extends 'enrich_content'
              ? {
                  contentId: string
                  baseUrl?: string | null
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
  write_content: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'write_content',
        description: 'Create a new content item (blog post, article, etc.) from source content (context, YouTube video, etc.). This tool only creates new content - use edit_metadata for metadata edits or edit_section for content edits on existing items.',
        parameters: buildWriteContentParameters()
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
  fetch_youtube: {
    kind: 'ingest',
    definition: {
      type: 'function',
      function: {
        name: 'fetch_youtube',
        description: 'Fetch captions from a YouTube video and create source content for content generation.',
        parameters: buildFetchYouTubeParameters()
      }
    }
  },
  save_source: {
    kind: 'ingest',
    definition: {
      type: 'function',
      function: {
        name: 'save_source',
        description: 'Save a pasted context as source content for later use in content generation.',
        parameters: buildSaveSourceParameters()
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
  enrich_content: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'enrich_content',
        description: 'Re-enrich existing content with frontmatter and JSON-LD structured data. Useful for updating old content or refreshing SEO metadata.',
        parameters: buildEnrichContentParameters()
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
  }
}

function buildWriteContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceContentId: {
        type: ['string', 'null'],
        description: 'Source content ID to generate from (context, YouTube ingest, etc.).'
      },
      sourceText: {
        type: ['string', 'null'],
        description: 'Inline context or notes to draft from when no sourceContentId exists.'
      },
      context: {
        type: ['string', 'null'],
        description: 'Raw context text to use for generating content.'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional working title for the content item.'
      },
      slug: {
        type: ['string', 'null']
      },
      status: {
        type: ['string', 'null'],
        description: 'Desired content status (draft, review, published, etc.).'
      },
      primaryKeyword: {
        type: ['string', 'null']
      },
      targetLocale: {
        type: ['string', 'null']
      },
      contentType: {
        type: ['string', 'null'],
        description: 'Content type identifier (blog_post, newsletter, etc.).'
      },
      systemPrompt: {
        type: ['string', 'null'],
        description: 'Custom system prompt overrides when the user provides style guidance.'
      },
      temperature: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 2,
        description: 'Sampling temperature for creative control (default 1).'
      }
    }
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

function buildFetchYouTubeParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      youtubeUrl: {
        type: 'string',
        description: 'YouTube video URL to ingest (e.g., https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID).'
      },
      titleHint: {
        type: ['string', 'null'],
        description: 'Optional title hint for the source content.'
      }
    },
    required: ['youtubeUrl']
  }
}

function buildSaveSourceParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description: 'Raw context text to save as source content.'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional title for the context source content.'
      }
    },
    required: ['context']
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

function buildEnrichContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID of the content item to re-enrich with frontmatter and JSON-LD structured data.'
      },
      baseUrl: {
        type: ['string', 'null'],
        description: 'Optional base URL for generating absolute URLs in JSON-LD structured data.'
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

export function parseChatToolCall(toolCall: ChatCompletionToolCall): ChatToolInvocation | null {
  const args = safeParseArguments(toolCall.function.arguments || '{}')
  if (!args) {
    return null
  }

  if (toolCall.function.name === 'write_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 'write_content',
      arguments: rest as ChatToolInvocation<'write_content'>['arguments']
    }
  }

  if (toolCall.function.name === 'edit_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_section',
      arguments: rest as ChatToolInvocation<'edit_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'fetch_youtube') {
    const { type: _omit, ...rest } = args
    return {
      name: 'fetch_youtube',
      arguments: rest as ChatToolInvocation<'fetch_youtube'>['arguments']
    }
  }

  if (toolCall.function.name === 'save_source') {
    const { type: _omit, ...rest } = args
    return {
      name: 'save_source',
      arguments: rest as ChatToolInvocation<'save_source'>['arguments']
    }
  }

  if (toolCall.function.name === 'edit_metadata') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_metadata',
      arguments: rest as ChatToolInvocation<'edit_metadata'>['arguments']
    }
  }

  if (toolCall.function.name === 'enrich_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 'enrich_content',
      arguments: rest as ChatToolInvocation<'enrich_content'>['arguments']
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

  return null
}
