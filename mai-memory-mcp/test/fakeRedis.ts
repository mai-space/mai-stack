/** Minimal in-memory stand-in for the subset of the `redis` client's API mai-memory-mcp uses. */
export function createFakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const zsets = new Map<string, Array<{ score: number; value: string }>>();

  return {
    async hGet(key: string, field: string): Promise<string | undefined> {
      return hashes.get(key)?.[field];
    },
    async hSet(key: string, fields: Record<string, unknown>): Promise<void> {
      const existing = hashes.get(key) ?? {};
      for (const [k, v] of Object.entries(fields)) existing[k] = String(v);
      hashes.set(key, existing);
    },
    async hGetAll(key: string): Promise<Record<string, string>> {
      return hashes.get(key) ?? {};
    },
    async hDel(key: string, field: string): Promise<void> {
      delete hashes.get(key)?.[field];
    },
    async zAdd(key: string, entry: { score: number; value: string }): Promise<void> {
      const set = zsets.get(key) ?? [];
      const idx = set.findIndex(e => e.value === entry.value);
      if (idx >= 0) set[idx] = entry; else set.push(entry);
      zsets.set(key, set);
    },
    async zRange(key: string, start: number, stop: number, opts?: { REV?: boolean }): Promise<string[]> {
      const set = [...(zsets.get(key) ?? [])].sort((a, b) => (opts?.REV ? b.score - a.score : a.score - b.score));
      const end = stop === -1 ? set.length : stop + 1;
      return set.slice(start, end).map(e => e.value);
    },
    async zRem(key: string, value: string): Promise<void> {
      const set = zsets.get(key);
      if (set) zsets.set(key, set.filter(e => e.value !== value));
    },
    async del(key: string): Promise<void> {
      hashes.delete(key);
    },
  };
}
