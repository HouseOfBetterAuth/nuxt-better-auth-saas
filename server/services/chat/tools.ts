import type {
  ChatCompletionToolCall,
  ChatCompletionToolDefinition
} from '~~/server/utils/aiGateway'

export type ChatToolName = 'generate_content' | 'patch_section'

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
        description: 'Deprecated alias for sourceText (raw transcript text).'
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
    }
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

  return null
}
