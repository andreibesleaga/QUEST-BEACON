// BEACON — CachePort adapter selector (FEATURE_CACHE: in-memory default ↔ Redis flag; T-128; ADR-001).
import type { CachePort } from '@/ports/infra.js';
import { makeInMemoryCache } from './in-memory-cache.js';
import { makeRedisCache } from './redis-cache.js';

export { makeInMemoryCache, InMemoryCache } from './in-memory-cache.js';
export { makeRedisCache, RedisCache } from './redis-cache.js';

/**
 * Build the active CachePort. Reads `process.env.FEATURE_CACHE` when `mode` is omitted;
 * `'redis'` selects the (stubbed) Redis flag path, anything else falls back to the in-memory
 * default (the locked demo default; also backs last-known-good, T-128 F6).
 */
export function makeCachePort(mode?: string): CachePort {
  const selected = mode ?? process.env.FEATURE_CACHE ?? 'memory';
  return selected === 'redis' ? makeRedisCache() : makeInMemoryCache();
}
