// BEACON — Last-known-good cache tests (E4·T-135; ADR-009/F6). A live-fail serves the cached FetchResult
// within TTL (degraded=true, original freshness preserved); a miss / TTL-expiry falls through with a typed
// error so the ladder can descend to the mock rung.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult } from './contract.js';
import { cacheKey, readLastGood, writeLastGood } from './last-known-good-cache.js';

class FakeCache implements CachePort {
  private readonly store = new Map<string, { value: unknown; expiresAt: number | null }>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    const e = this.store.get(key);
    if (e === undefined) return Promise.resolve(ok(null));
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.store.delete(key);
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(e.value as T));
  }
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<Result<void, DomainError>> {
    this.store.set(key, { value, expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : null });
    return Promise.resolve(ok(undefined));
  }
  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }
}

const liveFr: FetchResult<{ n: number }> = {
  records: [
    {
      entity: { n: 1 },
      provenance: {
        id: asId<SourceId>('11111111-1111-4111-8111-111111111111'),
        source: 'X',
        adapter: 'x',
        fetchedAt: '2026-07-05T10:00:00Z',
        license: 'Public Domain',
        mode: 'LIVE',
      },
    },
  ],
  freshness: '2026-07-05T10:00:00Z',
  mode: 'LIVE',
  degraded: false,
};

describe('last-known-good cache (F6)', () => {
  it('serves the cached result as CACHED+degraded, preserving the original freshness', async () => {
    const cache = new FakeCache();
    const key = cacheKey('x', 'ca');
    await writeLastGood(cache, key, liveFr, 900);
    const res = await readLastGood<{ n: number }>(cache, key);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T10:00:00Z'); // original freshness kept
    expect(res.value.records).toEqual(liveFr.records);
  });

  it('returns UPSTREAM_UNAVAILABLE on a cache miss', async () => {
    const res = await readLastGood(new FakeCache(), cacheKey('x', 'nope'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('falls through once the TTL has expired', async () => {
    let clock = 1_000_000;
    const cache = new FakeCache(() => clock);
    const key = cacheKey('x', 'ttl');
    await writeLastGood(cache, key, liveFr, 10); // 10s TTL
    clock += 11_000; // advance past TTL
    const res = await readLastGood(cache, key);
    expect(res.ok).toBe(false);
  });
});
