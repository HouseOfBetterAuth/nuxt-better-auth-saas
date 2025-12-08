/**
 * Cloudflare Vectorize Integration
 *
 * Working features:
 * - ✅ Vector embeddings (768 dimensions, @cf/baai/bge-base-en-v1.5)
 * - ✅ Vector storage and retrieval
 * - ✅ Vector similarity search
 * - ✅ Metadata retrieval (using returnMetadata: 'all')
 *
 * Note: When using returnMetadata: 'all', topK is limited to 20 by Cloudflare.
 * Metadata filtering requires fields to be indexed in the Vectorize index.
 */

import { createError } from 'h3'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const CF_ACCOUNT_ID = runtimeConfig.cfAccountId
const CF_VECTORIZE_INDEX = process.env.NUXT_CF_VECTORIZE_INDEX || runtimeConfig.cfVectorizeIndex || ''
const CF_VECTORIZE_API_TOKEN = process.env.NUXT_CF_VECTORIZE_API_TOKEN || runtimeConfig.cfVectorizeApiToken || ''
const CF_EMBED_MODEL = process.env.NUXT_CF_EMBED_MODEL || runtimeConfig.cfEmbedModel || '@cf/baai/bge-base-en-v1.5'

const VECTORIZE_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}`

export const isVectorizeConfigured = Boolean(
  CF_ACCOUNT_ID &&
  CF_VECTORIZE_INDEX &&
  CF_VECTORIZE_API_TOKEN &&
  CF_EMBED_MODEL
)

const authHeaders = () => {
  if (!isVectorizeConfigured) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Vector search is not configured.'
    })
  }

  return {
    'Authorization': `Bearer ${CF_VECTORIZE_API_TOKEN}`,
    'Content-Type': 'application/json'
  }
}

const normalizeEmbeddingEntry = (entry: any): number[] => {
  if (Array.isArray(entry)) {
    return entry.map(Number)
  }

  if (Array.isArray(entry?.data)) {
    return entry.data.map(Number)
  }

  if (Array.isArray(entry?.embedding)) {
    return entry.embedding.map(Number)
  }

  if (Array.isArray(entry?.vector)) {
    return entry.vector.map(Number)
  }

  return []
}

export const buildVectorId = (sourceContentId: string, chunkIndex: number) => {
  return `${sourceContentId}:${chunkIndex}`
}

export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (!texts.length) {
    return []
  }

  if (!isVectorizeConfigured) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Vector embeddings are not configured.'
    })
  }

  const endpoint = `${VECTORIZE_BASE}/ai/run/${CF_EMBED_MODEL}`
  const payload = texts.length === 1
    ? { text: texts[0] }
    : { text: texts }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errorPayload = await response.text()
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to create embeddings with Cloudflare AI',
      data: {
        message: errorPayload
      }
    })
  }

  const json = await response.json()
  const rawResult = Array.isArray(json?.result)
    ? json.result
    : Array.isArray(json?.result?.data)
      ? json.result.data
      : json?.result?.result

  if (!Array.isArray(rawResult)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Unexpected embedding response from Cloudflare AI'
    })
  }

  const embeddings = rawResult.map(normalizeEmbeddingEntry)

  if (embeddings.length !== texts.length) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Embedding count did not match requested texts.'
    })
  }

  const emptyEmbeddings = embeddings.filter(vector => vector.length === 0)
  if (emptyEmbeddings.length > 0) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Received empty embeddings from Cloudflare AI'
    })
  }

  return embeddings
}

export const embedText = async (text: string): Promise<number[]> => {
  const [vector] = await embedTexts([text])
  if (!vector) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to generate embedding for text'
    })
  }
  return vector
}

interface UpsertVectorInput {
  id: string
  values: number[]
  metadata?: Record<string, any>
}

export const upsertVectors = async (vectors: UpsertVectorInput[]) => {
  if (!vectors.length) {
    return
  }

  if (!isVectorizeConfigured) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Vector embeddings are not configured.'
    })
  }

  for (const vector of vectors) {
    const metadata = vector.metadata ?? {}
    if (!metadata.sourceContentId || !metadata.organizationId) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Vector metadata missing sourceContentId or organizationId'
      })
    }
  }

  const response = await fetch(
    `${VECTORIZE_BASE}/vectorize/v2/indexes/${encodeURIComponent(CF_VECTORIZE_INDEX)}/upsert`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ vectors })
    }
  )

  if (!response.ok) {
    const payload = await response.text()
    console.error('Failed to upsert vectors', { payload })
    throw createError({
      statusCode: 502,
      statusMessage: 'Cloudflare Vectorize upsert failed'
    })
  }
}

interface QueryVectorOptions {
  vector: number[]
  topK?: number
  filter?: Record<string, any>
}

interface VectorMatch {
  id: string
  score: number
  metadata?: Record<string, any>
}

export const queryVectorMatches = async ({
  vector,
  topK = 3,
  filter
}: QueryVectorOptions): Promise<VectorMatch[]> => {
  if (!isVectorizeConfigured || !vector.length) {
    return []
  }

  // Cloudflare Vectorize requires returnMetadata: 'all' to return metadata in query responses
  // Note: When using returnMetadata: 'all', topK is limited to 20
  const effectiveTopK = topK > 20 ? 20 : topK
  if (effectiveTopK < topK) {
    console.warn(`queryVectorMatches: topK capped from ${topK} to ${effectiveTopK} due to Cloudflare Vectorize limitation with returnMetadata`)
  }

  const response = await fetch(
    `${VECTORIZE_BASE}/vectorize/v2/indexes/${encodeURIComponent(CF_VECTORIZE_INDEX)}/query`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        topK: effectiveTopK,
        vector,
        filter,
        returnMetadata: 'all'
      })
    }
  )

  if (!response.ok) {
    const payload = await response.text()
    console.error('Vector query failed', { payload })
    throw createError({
      statusCode: 502,
      statusMessage: 'Cloudflare Vectorize query failed'
    })
  }

  const json = await response.json()
  const matches = Array.isArray(json?.result?.matches)
    ? json.result.matches
    : Array.isArray(json?.result?.results)
      ? json.result.results
      : Array.isArray(json?.result?.[0]?.matches)
        ? json.result[0].matches
        : []

  return matches
    .map((match: any) => ({
      id: match.id || match.vector_id || match.vectorId,
      score: typeof match.score === 'number' ? match.score : 0,
      metadata: match.metadata ?? {}
    }))
    .filter((match: any): match is VectorMatch => typeof match.id === 'string' && match.id.length > 0)
}
