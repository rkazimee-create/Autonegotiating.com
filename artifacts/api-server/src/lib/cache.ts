interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }
}

export const cache = new MemoryCache();

export const TTL = {
  TRIMS: 6 * 60 * 60 * 1000,       // 6 hours — trim lists are stable
  INVENTORY: 5 * 60 * 1000,         // 5 minutes — listings change but we want speed
  COMPARABLES: 5 * 60 * 1000,       // 5 minutes
  PRICE_HISTORY: 10 * 60 * 1000,    // 10 minutes
};
