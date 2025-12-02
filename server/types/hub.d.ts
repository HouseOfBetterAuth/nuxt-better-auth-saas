import type { KVNamespace } from '@cloudflare/workers-types'

declare global {
  const KV: KVNamespace
  const HYPERDRIVE: {
    connectionString: string
  }
}

export {}
