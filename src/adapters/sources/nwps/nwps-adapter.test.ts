// BEACON — NWPS adapter tests (E4·T-155; ADR-009/F1/F5/F6). Mode-switch each yields usable Gauge with
// correct mode/degraded/freshness; the live rung degrades to the recorded mock when upstream is
// unreachable; provenance is stamped; the outward FloodGaugePort adapts the ladder; non-US → NOT_COVERED.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Gauge, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { NwpsAdapter, makeNwpsAdapter } from './nwps-adapter.js';

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

const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-nwps' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('NwpsAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as Gauge (degraded, provenance MOCK)', async () => {
    const adapter = new NwpsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records[0]?.entity.floodCategory).toBe('MODERATE');
    expect(res.value.records[0]?.provenance.source).toBe('NOAA NWPS');
    expect(res.value.records[0]?.provenance.adapter).toBe('nwps');
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('nwps', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new NwpsAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new NwpsAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/nwps/v1' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('returns NOT_COVERED for a non-US region (OP4)', async () => {
    const adapter = new NwpsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('NwpsAdapter outward FloodGaugePort', () => {
  it('fetchGauges returns a Sourced envelope of Gauge with freshness', async () => {
    const adapter = new NwpsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchGauges({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new NwpsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('nwps');
  });
});

describe('makeNwpsAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeNwpsAdapter(mkEngine(new FakeCache()), { SOURCE_NWPS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<Gauge> {
  const entity = makeGauge({
    id: asId<GaugeId>('nwps:SEED'),
    geom: { type: 'Point', coordinates: [-121.5, 38.6] },
    floodCategory: 'MINOR',
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('33333333-3333-4333-8333-333333333333'),
          source: 'NOAA NWPS',
          adapter: 'nwps',
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
