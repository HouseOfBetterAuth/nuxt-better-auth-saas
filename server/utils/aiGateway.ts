import { createError } from 'h3'
import { runtimeConfig } from './runtimeConfig'

export interface ChatCompletionToolFunction {
  name: string
  description?: string
  parameters?: Record<string, any>
}

export interface ChatCompletionToolDefinition {
  type: 'function'
  function: ChatCompletionToolFunction
}

export interface ChatCompletionToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: ChatCompletionToolCall[]
}

interface CallChatCompletionsOptions {
  model?: string
  messages: ChatCompletionMessage[]
  temperature?: number
  maxTokens?: number
}

const CF_ACCOUNT_ID = runtimeConfig.cfAccountId
const CF_AI_GATEWAY_TOKEN = process.env.NUXT_CF_AI_GATEWAY_TOKEN || runtimeConfig.cfAiGatewayToken
const OPENAI_API_KEY = process.env.NUXT_OPENAI_API_KEY || runtimeConfig.openAiApiKey
const OPENAI_BLOG_MODEL = process.env.NUXT_OPENAI_BLOG_MODEL || runtimeConfig.openAiBlogModel || 'gpt-4.1-mini'

const parseNumberWithFallback = (value: string | number | undefined, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const OPENAI_BLOG_TEMPERATURE = parseNumberWithFallback(
  process.env.NUXT_OPENAI_BLOG_TEMPERATURE,
  parseNumberWithFallback(runtimeConfig.openAiBlogTemperature, 0.6)
)

const OPENAI_BLOG_MAX_OUTPUT_TOKENS = parseNumberWithFallback(
  process.env.NUXT_OPENAI_BLOG_MAX_OUTPUT_TOKENS,
  parseNumberWithFallback(runtimeConfig.openAiBlogMaxOutputTokens, 2200)
)

const gatewayBase = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/quill/compat`

interface CallChatCompletionsRawOptions extends CallChatCompletionsOptions {
  tools?: ChatCompletionToolDefinition[]
  toolChoice?: 'auto' | 'none' | { type: 'function', function: { name: string } }
}

export interface ChatCompletionResponse {
  id: string
  model: string
  created: number
  choices: Array<{
    index: number
    message: {
      content?: string | null
      tool_calls?: ChatCompletionToolCall[]
      role: string
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ChatCompletionChunk {
  id: string
  model: string
  created: number
  choices: Array<{
    index: number
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
      role?: string
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Non-streaming chat completions (used for content generation, not chat API)
 *
 * Note: The chat API endpoint uses callChatCompletionsStream exclusively.
 * This function is used by content generation services (composeBlogFromText, etc.)
 */
export async function callChatCompletionsRaw({
  model = OPENAI_BLOG_MODEL,
  messages,
  temperature = OPENAI_BLOG_TEMPERATURE,
  maxTokens = OPENAI_BLOG_MAX_OUTPUT_TOKENS,
  tools,
  toolChoice
}: CallChatCompletionsRawOptions): Promise<ChatCompletionResponse> {
  try {
    if (!OPENAI_API_KEY) {
      throw createError({
        statusCode: 500,
        statusMessage: 'OpenAI API key not configured',
        data: {
          message: 'NUXT_OPENAI_API_KEY environment variable is required'
        }
      })
    }

    if (!CF_AI_GATEWAY_TOKEN) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Cloudflare AI Gateway token not configured',
        data: {
          message: 'NUXT_CF_AI_GATEWAY_TOKEN environment variable is required'
        }
      })
    }

    const modelName = model.startsWith('openai/') ? model : `openai/${model}`
    const url = `${gatewayBase}/chat/completions`

    const systemMessageIndex = messages.findIndex(message => message.role === 'system')
    const orderedMessages = systemMessageIndex > 0
      ? [messages[systemMessageIndex], ...messages.slice(0, systemMessageIndex), ...messages.slice(systemMessageIndex + 1)]
      : messages

    const body: Record<string, any> = {
      model: modelName,
      messages: orderedMessages,
      temperature,
      max_completion_tokens: maxTokens
    }

    if (tools?.length) {
      body.tools = tools
      if (toolChoice) {
        body.tool_choice = toolChoice
      }
    }

    const response = await $fetch<ChatCompletionResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'cf-aig-authorization': `Bearer ${CF_AI_GATEWAY_TOKEN}`
      },
      body
    })

    return response
  } catch (error: any) {
    console.error('AI Gateway request failed', {
      model,
      temperature,
      maxTokens,
      error: error?.message || error
    })

    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to reach AI Gateway',
      data: {
        message: error?.message || 'Unknown AI Gateway error'
      }
    })
  }
}

export async function* callChatCompletionsStream({
  model = OPENAI_BLOG_MODEL,
  messages,
  temperature = OPENAI_BLOG_TEMPERATURE,
  maxTokens = OPENAI_BLOG_MAX_OUTPUT_TOKENS,
  tools,
  toolChoice
}: CallChatCompletionsRawOptions): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  // Declare url outside try block so it's available in catch block for error logging
  const modelName = model.startsWith('openai/') ? model : `openai/${model}`
  const url = `${gatewayBase}/chat/completions`

  try {
    if (!OPENAI_API_KEY) {
      throw createError({
        statusCode: 500,
        statusMessage: 'OpenAI API key not configured',
        data: {
          message: 'NUXT_OPENAI_API_KEY environment variable is required'
        }
      })
    }

    if (!CF_AI_GATEWAY_TOKEN) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Cloudflare AI Gateway token not configured',
        data: {
          message: 'NUXT_CF_AI_GATEWAY_TOKEN environment variable is required'
        }
      })
    }

    const systemMessageIndex = messages.findIndex(message => message.role === 'system')
    const orderedMessages = systemMessageIndex > 0
      ? [messages[systemMessageIndex], ...messages.slice(0, systemMessageIndex), ...messages.slice(systemMessageIndex + 1)]
      : messages

    const body: Record<string, any> = {
      model: modelName,
      messages: orderedMessages,
      temperature,
      max_completion_tokens: maxTokens,
      stream: true
    }

    if (tools?.length) {
      body.tools = tools
      if (toolChoice) {
        body.tool_choice = toolChoice
      }
    }

    // Log request details for debugging (sanitize sensitive data)
    console.log('[AI Gateway] Preparing streaming request:', {
      url,
      model: modelName,
      messageCount: messages.length,
      hasSystemMessage: systemMessageIndex >= 0,
      toolCount: tools?.length || 0,
      toolNames: tools?.map(t => t.function?.name).filter(Boolean) || [],
      toolChoice: toolChoice || 'auto',
      temperature,
      maxTokens,
      hasApiKey: !!OPENAI_API_KEY,
      hasGatewayToken: !!CF_AI_GATEWAY_TOKEN,
      gatewayBase,
      bodyKeys: Object.keys(body),
      messageRoles: messages.map(m => m.role)
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'cf-aig-authorization': `Bearer ${CF_AI_GATEWAY_TOKEN}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      const errorDetails = {
        status: response.status,
        statusText: response.statusText,
        url,
        model: modelName,
        messageCount: messages.length,
        toolCount: tools?.length || 0,
        hasApiKey: !!OPENAI_API_KEY,
        hasGatewayToken: !!CF_AI_GATEWAY_TOKEN,
        errorResponse: errorText
      }

      console.error('[AI Gateway] Request failed with non-OK status:', errorDetails)

      throw createError({
        statusCode: response.status,
        statusMessage: 'AI Gateway request failed',
        data: {
          message: 'AI Gateway request failed',
          ...(process.env.NODE_ENV === 'development'
            ? { details: errorDetails }
            : {})
        }
      })
    }

    if (!response.body) {
      throw createError({
        statusCode: 502,
        statusMessage: 'No response body from AI Gateway',
        data: {
          message: 'Stream response body is null'
        }
      })
    }

    const reader = response.body.getReader()
    try {
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.slice(6)
            try {
              const chunk: ChatCompletionChunk = JSON.parse(jsonStr)
              yield chunk
            } catch (parseError) {
              console.error('Failed to parse SSE chunk:', jsonStr, parseError)
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmedLine = buffer.trim()
        if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
          const jsonStr = trimmedLine.slice(6)
          try {
            const chunk: ChatCompletionChunk = JSON.parse(jsonStr)
            yield chunk
          } catch (parseError) {
            console.error('Failed to parse final SSE chunk:', jsonStr, parseError)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  } catch (error: any) {
    // Extract detailed error information
    const errorMessage = error?.message || error?.data?.message || 'Unknown AI Gateway error'
    const errorStatus = error?.statusCode || error?.status || 502
    const errorResponse = error?.response || error?.data?.response || error?.data
    const errorStack = error instanceof Error ? error.stack : undefined

    // Log comprehensive error details
    const errorContext = {
      model,
      temperature,
      maxTokens,
      error: errorMessage,
      status: errorStatus,
      statusCode: error?.statusCode,
      statusText: error?.statusText,
      response: errorResponse,
      responseData: error?.data,
      responseBody: error?.response?.data || error?.response?._data,
      headers: error?.response?.headers,
      url: error?.config?.url || error?.request?.url || url,
      stack: errorStack,
      fullError: error,
      // Additional context for debugging
      messageCount: messages?.length || 0,
      toolCount: tools?.length || 0,
      toolNames: tools?.map(t => t.function?.name).filter(Boolean) || [],
      toolChoice: toolChoice || 'auto',
      hasApiKey: !!OPENAI_API_KEY,
      hasGatewayToken: !!CF_AI_GATEWAY_TOKEN,
      gatewayBase,
      requestBody: {
        model: modelName,
        messageCount: messages?.length || 0,
        hasTools: !!(tools?.length),
        toolChoice: toolChoice || 'auto',
        stream: true
      }
    }

    console.error('[AI Gateway] Streaming request failed with detailed context:', errorContext)

    // Preserve original error status code if it exists, otherwise default to 502
    const statusCode = errorStatus
    const statusMessage = error?.statusMessage || 'Failed to reach AI Gateway'
    const finalErrorMessage = errorMessage

    throw createError({
      statusCode,
      statusMessage,
      data: {
        message: finalErrorMessage,
        originalStatus: error?.status,
        originalStatusText: error?.statusText,
        ...(process.env.NODE_ENV === 'development'
          ? {
              response: errorResponse,
              stack: errorStack
            }
          : {})
      }
    })
  }
}

export async function callChatCompletions({
  model = OPENAI_BLOG_MODEL,
  messages,
  temperature = OPENAI_BLOG_TEMPERATURE,
  maxTokens = OPENAI_BLOG_MAX_OUTPUT_TOKENS
}: CallChatCompletionsOptions): Promise<string> {
  const response = await callChatCompletionsRaw({
    model,
    messages,
    temperature,
    maxTokens
  })

  const content = response?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : String(content ?? '')
}

interface ComposeBlogOptions {
  systemPrompt?: string
  temperature?: number
}

interface ComposeBlogResult {
  markdown: string
  meta: Record<string, any>
}

export async function composeBlogFromText(text: string, options?: ComposeBlogOptions): Promise<ComposeBlogResult> {
  const systemPrompt = options?.systemPrompt || 'You are an expert SEO content writer. Produce a high-quality, well-structured article in markdown (MDX-compatible).'
  const userPrompt = text

  const markdown = await callChatCompletions({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: options?.temperature
  })

  return {
    markdown,
    meta: {
      engine: 'cloudflare-ai-gateway',
      model: OPENAI_BLOG_MODEL
    }
  }
}

export async function callAiGatewayForSection(systemPrompt: string, userPrompt: string): Promise<string> {
  return await callChatCompletions({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  })
}
