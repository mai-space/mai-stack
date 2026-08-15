/** Minimal in-memory stand-in for the subset of the `redis` client's API mai-dispatcher uses. */
export function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, value: unknown, _opts?: unknown): Promise<void> {
      store.set(key, String(value));
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
    async incr(key: string): Promise<number> {
      const v = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(v));
      return v;
    },
    async decr(key: string): Promise<number> {
      const v = parseInt(store.get(key) ?? '0', 10) - 1;
      store.set(key, String(v));
      return v;
    },
    async incrByFloat(key: string, delta: number): Promise<number> {
      const v = parseFloat(store.get(key) ?? '0') + delta;
      store.set(key, String(v));
      return v;
    },
    async expire(_key: string, _seconds: number): Promise<void> {
      // TTL is not modeled — no test here depends on real expiry timing
    },
  };
}
