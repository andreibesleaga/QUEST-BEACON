// BEACON — Last-known-good cache wrapper (E4·T-134/T-135; adapter-contract §3.1.3, ADR-009/F6).
// DEPENDS on the injected CachePort (DI, never constructs one). On a live failure or mode=CACHED, the
// most recent good FetchResult is re-served with the ORIGINAL freshness preserved and degraded=true —
// so the COP shows real data + a "stale" label instead of a dead-end (Art. XVI).
import type { CachePort } from '@/ports/infra.js';
import type { AdapterResult, FetchResult } from './contract.js';
import { ok, err } from './contract.js';
import { makeAdapterError } from './errors.js';

/** Deterministic per-adapter, per-region cache key. */
export function cacheKey(adapterId: string, regionId: string): string {
  return `lkg:${adapterId}:${regionId}`;
}

/** Store a successful live FetchResult as last-known-good (best-effort; a cache write failure is non-fatal). */
export async function writeLastGood<T>(
  cache: CachePort,
  key: string,
  fr: FetchResult<T>,
  ttlSec: number,
): Promise<void> {
  await cache.set(key, fr, ttlSec > 0 ? ttlSec : undefined);
}

/** Serve the last-known-good FetchResult within TTL. Returns UPSTREAM_UNAVAILABLE on miss/expiry. */
export async function readLastGood<T>(
  cache: CachePort,
  key: string,
): Promise<AdapterResult<FetchResult<T>>> {
  const res = await cache.get<FetchResult<T>>(key);
  if (!res.ok) {
    return err(makeAdapterError('UPSTREAM_UNAVAILABLE', `cache read failed: ${res.error.message}`));
  }
  if (res.value === null) {
    return err(
      makeAdapterError('UPSTREAM_UNAVAILABLE', 'last-known-good cache miss', { retryable: false }),
    );
  }
  const cached = res.value;
  // Preserve original freshness; mark the served copy CACHED + degraded (F6 invariant).
  return ok({
    records: cached.records,
    freshness: cached.freshness,
    mode: 'CACHED',
    degraded: true,
  });
}
