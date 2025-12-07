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
  role: 'system' | 'user' | 'assistant'
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

export async function callChatCompletionsRaw({
  model = OPENAI_BLOG_MODEL,
  messages,
  temperature = OPENAI_BLOG_TEMPERATURE,
  maxTokens = OPENAI_BLOG_MAX_OUTPUT_TOKENS,
  tools,
  toolChoice
}: CallChatCompletionsRawOptions) {
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

    const response = await $fetch<any>(url, {
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
