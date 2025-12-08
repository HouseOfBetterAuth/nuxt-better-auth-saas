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
      max_completion_tokens: maxTokens,
      stream: true
    }

    if (tools?.length) {
      body.tools = tools
      if (toolChoice) {
        body.tool_choice = toolChoice
      }
    }

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
      throw createError({
        statusCode: response.status,
        statusMessage: 'AI Gateway request failed',
        data: {
          message: errorText || 'Unknown AI Gateway error'
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
    const decoder = new TextDecoder()
    let buffer = ''

    try {
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
    console.error('AI Gateway streaming request failed', {
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
