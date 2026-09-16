// BEACON — USGS Water adapter tests (E4·T-156; ADR-009/F1/F5/F6, adapter-contract §6). The full
// redundancy ladder (live → last-known-good cache → recorded-mock → unavailable) yields a usable canonical
// Gauge in every mode; the live rung degrades to the recorded mock when upstream is unreachable; repeated
// live failures trip the shared circuit breaker OPEN; the ACL maps the recorded IV JSON to Gauge (raw
// stage, floodCategory NONE); non-US → NOT_COVERED; the outward FloodGaugePort adapts the ladder.
// Deterministic: fixed clock (nowIso), no network on the mock/cache paths, unroutable host for LIVE-down.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Gauge, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { UsgsWaterAdapter, makeUsgsWaterAdapter } from './usgs-water-adapter.js';

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

const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42] }; // inside the US coverage bbox
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-usgs' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('UsgsWaterAdapter mode-switch', () => {
  it('MOCK mode maps the recorded IV JSON to Gauge (degraded, provenance MOCK, raw stage)', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(2); // two fixture time-series
    const first = res.value.records[0];
    expect(first?.entity.id).toBe('usgs:11447650');
    expect(first?.entity.geom).toEqual({ type: 'Point', coordinates: [-121.5008, 38.4555] });
    expect(first?.entity.stage).toBe(14.63); // latest of the two observations (ACL mapping)
    expect(first?.entity.floodCategory).toBe('NONE'); // USGS IV = raw stage (honest limitation)
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('USGS Water Services');
    expect(first?.provenance.adapter).toBe('usgs-water');
    expect(first?.provenance.license).toBe('Public Domain (US Gov)');
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('usgs-water', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new UsgsWaterAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
    expect(res.value.records[0]?.entity.id).toBe('usgs:SEED');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/nwis/iv/' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode prefers last-known-good cache over the mock when the cache is warm (F6 → OP3)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('usgs-water', region.id), seedFetchResult('2026-07-05T19:30:00Z'));
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(cache),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/nwis/iv/' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T19:30:00Z');
  });

  it('trips the shared circuit breaker OPEN after consecutive live failures (SPEC §8.1)', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/nwis/iv/' }),
      breaker: { failureThreshold: 2, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    expect(adapter.health().state).toBe('CLOSED');
    await adapter.fetch(region); // failure 1 (still degrades to mock)
    await adapter.fetch(region); // failure 2 → breaker opens
    expect(adapter.health().state).toBe('OPEN');
    // Even OPEN, the ladder never dead-ends: the fetch still returns a usable (degraded) result.
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('returns NOT_COVERED for a non-US region (OP4)', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('UsgsWaterAdapter outward FloodGaugePort', () => {
  it('fetchGauges returns a Sourced envelope of Gauge with freshness', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchGauges({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2);
    expect(res.value.data[0]?.floodCategory).toBe('NONE');
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('maps a ladder failure to a NOT_FOUND DomainError for the outward port', async () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchGauges({ bbox: [20, 43, 30, 48] }); // non-US → NOT_COVERED
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new UsgsWaterAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('usgs-water');
    expect(adapter.coverage).toEqual({ kind: 'BBOX', bbox: [-180, 15, -60, 72] });
  });
});

describe('makeUsgsWaterAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode MOCK)', () => {
    const res = makeUsgsWaterAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('honours SOURCE_USGS_WATER_MODE from env', () => {
    const res = makeUsgsWaterAdapter(mkEngine(new FakeCache()), {
      SOURCE_USGS_WATER_MODE: 'CACHED',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<Gauge> {
  const entity = makeGauge({
    id: asId<GaugeId>('usgs:SEED'),
    geom: { type: 'Point', coordinates: [-121.5, 38.6] },
    floodCategory: 'NONE',
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'USGS Water Services',
          adapter: 'usgs-water',
          fetchedAt,
          license: 'Public Domain (US Gov)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
