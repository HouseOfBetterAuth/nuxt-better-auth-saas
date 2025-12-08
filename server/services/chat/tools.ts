import type {
  ChatCompletionToolCall,
  ChatCompletionToolDefinition
} from '~~/server/utils/aiGateway'

export type ChatToolName = 'generate_content' | 'patch_section' | 'ingest_youtube' | 'save_transcript' | 'update_metadata' | 're_enrich_content'

export type ChatToolArguments<TName extends ChatToolName> =
  TName extends 'generate_content'
    ? {
        contentId?: string | null
        sourceContentId?: string | null
        sourceText?: string | null
        transcript?: string | null
        title?: string | null
        slug?: string | null
        status?: string | null
        primaryKeyword?: string | null
        targetLocale?: string | null
        contentType?: string | null
        systemPrompt?: string | null
        temperature?: number | null
      }
    : TName extends 'patch_section'
      ? {
          contentId: string
          sectionId?: string | null
          sectionTitle?: string | null
          instructions?: string | null
          temperature?: number | null
        }
      : TName extends 'ingest_youtube'
        ? {
            youtubeUrl: string
            titleHint?: string | null
          }
        : TName extends 'save_transcript'
          ? {
              transcript: string
              title?: string | null
            }
          : TName extends 'update_metadata'
            ? {
                contentId: string
                title?: string | null
                slug?: string | null
                status?: string | null
                primaryKeyword?: string | null
                targetLocale?: string | null
                contentType?: string | null
              }
            : TName extends 're_enrich_content'
              ? {
                  contentId: string
                  baseUrl?: string | null
                }
              : never

export interface ChatToolInvocation<TName extends ChatToolName = ChatToolName> {
  name: TName
  arguments: ChatToolArguments<TName>
}

type ParameterSchema = Record<string, any>

const chatToolDefinitions: Record<ChatToolName, ChatCompletionToolDefinition> = {
  generate_content: {
    type: 'function',
    function: {
      name: 'generate_content',
      description: 'Create or update a long-form draft in the workspace using a prepared source such as a transcript or YouTube video.',
      parameters: buildGenerateContentParameters()
    }
  },
  patch_section: {
    type: 'function',
    function: {
      name: 'patch_section',
      description: 'Revise a specific section of an existing draft using the user\'s instructions.',
      parameters: buildPatchSectionParameters()
    }
  },
  ingest_youtube: {
    type: 'function',
    function: {
      name: 'ingest_youtube',
      description: 'Fetch captions from a YouTube video and create source content for drafting.',
      parameters: buildIngestYouTubeParameters()
    }
  },
  save_transcript: {
    type: 'function',
    function: {
      name: 'save_transcript',
      description: 'Save a pasted transcript as source content for later use in drafting.',
      parameters: buildSaveTranscriptParameters()
    }
  },
  update_metadata: {
    type: 'function',
    function: {
      name: 'update_metadata',
      description: 'Update metadata fields (title, slug, status, primaryKeyword, targetLocale, contentType) for an existing draft.',
      parameters: buildUpdateMetadataParameters()
    }
  },
  re_enrich_content: {
    type: 'function',
    function: {
      name: 're_enrich_content',
      description: 'Re-enrich existing content with frontmatter and JSON-LD structured data. Useful for updating old content or refreshing SEO metadata.',
      parameters: buildReEnrichContentParameters()
    }
  }
}

function buildGenerateContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: ['string', 'null'],
        description: 'Existing content ID to update. Use null to create a new draft.'
      },
      sourceContentId: {
        type: ['string', 'null'],
        description: 'Source content ID to draft from (transcript, YouTube ingest, etc.).'
      },
      sourceText: {
        type: ['string', 'null'],
        description: 'Inline transcript or notes to draft from when no sourceContentId exists.'
      },
      transcript: {
        type: ['string', 'null'],
        description: 'Raw transcript text to use for generating content.'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional working title for the draft.'
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

function buildPatchSectionParameters(): ParameterSchema {
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

function buildIngestYouTubeParameters(): ParameterSchema {
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

function buildSaveTranscriptParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      transcript: {
        type: 'string',
        description: 'Raw transcript text to save as source content.'
      },
      title: {
        type: ['string', 'null'],
        description: 'Optional title for the transcript source content.'
      }
    },
    required: ['transcript']
  }
}

function buildUpdateMetadataParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID of the draft to update.'
      },
      title: {
        type: ['string', 'null'],
        description: 'New title for the draft.'
      },
      slug: {
        type: ['string', 'null'],
        description: 'New slug for the draft (will be auto-slugified).'
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

function buildReEnrichContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID of the draft to re-enrich with frontmatter and JSON-LD structured data.'
      },
      baseUrl: {
        type: ['string', 'null'],
        description: 'Optional base URL for generating absolute URLs in JSON-LD structured data.'
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
  return Object.values(chatToolDefinitions)
}

export function parseChatToolCall(toolCall: ChatCompletionToolCall): ChatToolInvocation | null {
  const args = safeParseArguments(toolCall.function.arguments || '{}')
  if (!args) {
    return null
  }

  if (toolCall.function.name === 'generate_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 'generate_content',
      arguments: rest as ChatToolInvocation<'generate_content'>['arguments']
    }
  }

  if (toolCall.function.name === 'patch_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'patch_section',
      arguments: rest as ChatToolInvocation<'patch_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'ingest_youtube') {
    const { type: _omit, ...rest } = args
    return {
      name: 'ingest_youtube',
      arguments: rest as ChatToolInvocation<'ingest_youtube'>['arguments']
    }
  }

  if (toolCall.function.name === 'save_transcript') {
    const { type: _omit, ...rest } = args
    return {
      name: 'save_transcript',
      arguments: rest as ChatToolInvocation<'save_transcript'>['arguments']
    }
  }

  if (toolCall.function.name === 'update_metadata') {
    const { type: _omit, ...rest } = args
    return {
      name: 'update_metadata',
      arguments: rest as ChatToolInvocation<'update_metadata'>['arguments']
    }
  }

  if (toolCall.function.name === 're_enrich_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 're_enrich_content',
      arguments: rest as ChatToolInvocation<'re_enrich_content'>['arguments']
    }
  }

  return null
}
