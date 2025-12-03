import type { HubKV } from '@nuxthub/core'

declare global {
  const hubKV: () => HubKV
}

export {}
