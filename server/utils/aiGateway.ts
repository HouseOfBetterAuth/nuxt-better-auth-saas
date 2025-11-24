import { createError } from 'h3'
import { runtimeConfig } from './runtimeConfig'

interface CallChatCompletionsOptions {
  model?: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

const CF_ACCOUNT_ID = runtimeConfig.fileManager.storage.r2.accountId
const CF_AI_GATEWAY_TOKEN = process.env.NUXT_CF_AI_GATEWAY_TOKEN || runtimeConfig.cfAiGatewayToken
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

const gatewayBase = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/quill/openai`

export async function callChatCompletions({
  model = OPENAI_BLOG_MODEL,
  systemPrompt,
  userPrompt,
  temperature = OPENAI_BLOG_TEMPERATURE,
  maxTokens = OPENAI_BLOG_MAX_OUTPUT_TOKENS
}: CallChatCompletionsOptions): Promise<string> {
  try {
    const response = await $fetch<any>(`${gatewayBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${CF_AI_GATEWAY_TOKEN}`
      },
      body: {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_completion_tokens: maxTokens
      }
    })

    const content = response?.choices?.[0]?.message?.content

    if (Array.isArray(content)) {
      return content.map((c: any) => c.text ?? c).join('')
    }

    return typeof content === 'string' ? content : ''
  } catch (error: any) {
    console.error('AI Gateway request failed', {
      model,
      temperature,
      maxTokens,
      systemPromptPreview: systemPrompt?.slice(0, 200),
      userPromptPreview: userPrompt?.slice(0, 200),
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
    systemPrompt,
    userPrompt,
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
    systemPrompt,
    userPrompt
  })
}
