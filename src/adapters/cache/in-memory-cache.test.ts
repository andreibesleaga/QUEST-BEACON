// BEACON — In-memory CachePort tests (T-128; deterministic via injected fake clock, no real timers).
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { makeInMemoryCache } from './in-memory-cache.js';

/** A controllable clock: `at()` is passed to the cache, `advance()` moves virtual time forward. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('InMemoryCache', () => {
  it('set then get returns the stored value', async () => {
    const cache = makeInMemoryCache();
    await cache.set('k', { hello: 'world' });
    const r = await cache.get<{ hello: string }>('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toEqual({ hello: 'world' });
  });

  it('get of a missing key returns ok(null)', async () => {
    const cache = makeInMemoryCache();
    const r = await cache.get('nope');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBeNull();
  });

  it('returns the value before TTL expiry', async () => {
    const clock = fakeClock();
    const cache = makeInMemoryCache(clock.now);
    await cache.set('k', 'v', 10);
    clock.advance(9_999); // just under 10s
    const r = await cache.get<string>('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe('v');
  });

  it('returns ok(null) once the TTL has elapsed (lazy eviction)', async () => {
    const clock = fakeClock();
    const cache = makeInMemoryCache(clock.now);
    await cache.set('k', 'v', 10);
    clock.advance(10_000); // now() >= expiresAt
    const r = await cache.get<string>('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBeNull();
  });

  it('entries without a TTL never expire', async () => {
    const clock = fakeClock();
    const cache = makeInMemoryCache(clock.now);
    await cache.set('k', 'v');
    clock.advance(1_000_000_000);
    const r = await cache.get<string>('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe('v');
  });

  it('delete removes the entry', async () => {
    const cache = makeInMemoryCache();
    await cache.set('k', 'v');
    await cache.delete('k');
    const r = await cache.get('k');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBeNull();
  });

  it('keeps last-known-good: a source-miss never overwrites the good value (T-128 F6)', async () => {
    const cache = makeInMemoryCache();
    // A prior successful source populated the cache.
    await cache.set('geo:zone-42', { exposure: 0.87 });
    // A later fetch MISSES → the caller does NOT call set(). The good value must remain.
    const r = await cache.get<{ exposure: number }>('geo:zone-42');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toEqual({ exposure: 0.87 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid ttlSeconds (%s) with INVARIANT_VIOLATION',
    async (ttl) => {
      const cache = makeInMemoryCache();
      const r = await cache.set('k', 'v', ttl);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
      // Rejected write must not have stored anything.
      const g = await cache.get('k');
      if (isOk(g)) expect(g.value).toBeNull();
    },
  );
});
