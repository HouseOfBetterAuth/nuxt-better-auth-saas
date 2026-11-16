// Stand-in for NuxtHub's generated `hub:kv` module in unit tests.
const store = new Map<string, unknown>()

export const kv = {
  get: async (key: string) => store.get(key) ?? null,
  set: async (key: string, value: unknown) => {
    store.set(key, value)
  },
  del: async (key: string) => {
    store.delete(key)
  }
}
