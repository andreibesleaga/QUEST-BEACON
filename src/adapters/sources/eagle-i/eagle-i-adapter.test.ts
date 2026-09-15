// BEACON — EAGLE-I adapter tests (E4·T-166; adapter-contract/ADR-009/F1/F5/F6/OP4). Mode-switch
// (cached/live) each yields usable OutageRecord with the correct mode/degraded/freshness; CACHED is the
// adapter's default mode (honest gov-operational live-gating, see eagle-i-adapter.ts header); the LIVE
// rung degrades to the recorded mock when upstream is unreachable; provenance is stamped on every record;
// the outward OutagePort.fetchOutages adapts the ladder to the Sourced envelope; the factory fails fast
// on both invalid config AND an un-overridden LIVE default URL.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { OutageRecord } from '@/ports/infrastructure-sources.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { EagleIAdapter, makeEagleIAdapter } from './eagle-i-adapter.js';

class FakeCache implements CachePort {
  readonly store = new Map<string, unknown>();
  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    return Promise.resolve(ok((this.store.get(key) ?? null) as T | null));
  }
  set<T>(key: string, value: T): Promise<Result<void, DomainError>> {
    this.store.set(key, value);
    return Promise.resolve(ok(undefined));
  }
  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }
}

const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-eaglei' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('EagleIAdapter mode-switch', () => {
  it('CACHED mode with an empty cache falls back to the recorded mock fixture (degraded, provenance MOCK)', async () => {
    const adapter = new EagleIAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.area).toHaveLength(4);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('DOE/ORNL EAGLE-I');
    expect(first?.provenance.license).toBe('US public domain (DOE/ORNL EAGLE-I)');
    expect(first?.provenance.adapter).toBe('eagle-i');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    const seeded = seedFetchResult('2026-07-05T20:00:00Z');
    cache.store.set(cacheKey('eagle-i', region.id), seeded);
    const adapter = new EagleIAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 -> OP3)', async () => {
    const adapter = new EagleIAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/eagle-i-operational' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('gates a non-US region as NOT_COVERED (EAGLE-I is US-only, county-granular)', async () => {
    const adapter = new EagleIAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('EagleIAdapter outward OutagePort', () => {
  it('fetchOutages returns a Sourced envelope of OutageRecord with freshness', async () => {
    const adapter = new EagleIAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetchOutages({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.data[0]?.area).toHaveLength(4);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new EagleIAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('eagle-i');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeEagleIAdapter factory', () => {
  it('builds a CACHED adapter from env when SOURCE_EAGLE_I_MODE is unset (honest default)', () => {
    const res = makeEagleIAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('fails fast (CONFIG) when LIVE mode keeps the default (non-operational) URL', () => {
    const res = makeEagleIAdapter(mkEngine(new FakeCache()), { SOURCE_EAGLE_I_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('builds a LIVE adapter once the operator overrides SOURCE_EAGLE_I_URL with their own endpoint', () => {
    const res = makeEagleIAdapter(mkEngine(new FakeCache()), {
      SOURCE_EAGLE_I_MODE: 'LIVE',
      SOURCE_EAGLE_I_URL: 'https://gov-client-supplied.example/eagle-i/operational',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<OutageRecord> {
  const entity: OutageRecord = {
    area: [-121.7669, 39.4755, -121.4669, 39.7755],
    customersOut: 100,
    observedAt: fetchedAt,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('33333333-3333-4333-8333-333333333334'),
          source: 'DOE/ORNL EAGLE-I',
          adapter: 'eagle-i',
          fetchedAt,
          license: 'US public domain (DOE/ORNL EAGLE-I)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
