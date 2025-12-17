import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Storage } from 'unstorage'

declare module 'hub:kv' {
  interface KVStorage extends Storage {
    keys: Storage['getKeys']
    get: Storage['getItem']
    set: Storage['setItem']
    has: Storage['hasItem']
    del: Storage['removeItem']
    clear: Storage['clear']
  }

  export const kv: KVStorage
}

declare module 'hub:db' {
  // NuxtHub exposes a Drizzle database instance backed by postgres-js.
  // We type it loosely here since schema is project-specific.
  export const db: PostgresJsDatabase<Record<string, never>>
}

export {}
