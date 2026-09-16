// BEACON — CachePort selector tests (FEATURE_CACHE routing; T-128).
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { InMemoryCache, makeCachePort, RedisCache } from './index.js';

describe('makeCachePort', () => {
  it('defaults to a working in-memory cache', async () => {
    const cache = makeCachePort();
    expect(cache).toBeInstanceOf(InMemoryCache);
    await cache.set('k', 'v');
    const r = await cache.get<string>('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe('v');
  });

  it('selects the Redis stub for mode "redis"', () => {
    expect(makeCachePort('redis')).toBeInstanceOf(RedisCache);
  });

  it('falls back to in-memory for an unknown mode', () => {
    expect(makeCachePort('nonsense')).toBeInstanceOf(InMemoryCache);
  });

  it('the Redis stub yields err from get', async () => {
    const cache = makeCachePort('redis');
    const r = await cache.get('k');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
  });
});
