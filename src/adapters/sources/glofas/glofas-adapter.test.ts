// BEACON — GloFAS adapter tests (E4·T-173; ADR-009/F1/F5/F6). Mode-switch (MOCK/CACHED/LIVE) each yields
// usable Gauge with correct mode/degraded/freshness; CACHED with an empty cache degrades to the recorded
// mock (never a dead-end); the live rung degrades to the mock when the account-gated upstream is
// unreachable; provenance is stamped; the outward FloodGaugePort adapts the ladder; coverage is GLOBAL;
// the factory requires GLOFAS_CDS_KEY for LIVE. Deterministic clock fixed in the past (no wall-clock).
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Gauge, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { GlofasAdapter, makeGlofasAdapter } from './glofas-adapter.js';

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

// Romania — GloFAS's non-US flood demo region (a global adapter, so any bbox is covered).
const region: Region = { id: 'ro', bbox: [20, 43, 30, 48] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-glofas' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({ mode, timeoutMs: 400, ...extra });

describe('GlofasAdapter mode-switch', () => {
  it('MOCK mode serves the recorded reporting points as Gauge (degraded, provenance MOCK)', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records[0]?.entity.floodCategory).toBe('MODERATE');
    expect(res.value.records[0]?.provenance.source).toBe('Copernicus GloFAS');
    expect(res.value.records[0]?.provenance.adapter).toBe('glofas');
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('glofas', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new GlofasAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('CACHED mode with an empty cache degrades to the recorded mock (never a dead-end, Art. XVI)', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode degrades to the recorded mock when the gated upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new GlofasAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/glofas/wms', apiKey: 'test-key' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('GlofasAdapter outward FloodGaugePort', () => {
  it('fetchGauges returns a Sourced envelope of Gauge with freshness', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchGauges({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('covers any region (GLOBAL) and reports a healthy (CLOSED) breaker + identity', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'bd', bbox: [88, 20, 93, 27] }); // Bangladesh — non-RO global point
    expect(res.ok).toBe(true);
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('glofas');
  });
});

describe('makeGlofasAdapter factory', () => {
  it('builds a CACHED adapter by default from env', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('fails fast (CONFIG) when LIVE mode is set without GLOFAS_CDS_KEY', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), { SOURCE_GLOFAS_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('builds a LIVE adapter when the CDS key is present', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), { SOURCE_GLOFAS_MODE: 'LIVE', GLOFAS_CDS_KEY: 'k' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<Gauge> {
  const entity = makeGauge({
    id: asId<GaugeId>('glofas:SEED'),
    geom: { type: 'Point', coordinates: [27.9, 45.4] },
    floodCategory: 'MINOR',
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'Copernicus GloFAS',
          adapter: 'glofas',
          fetchedAt,
          license: 'Copernicus open (free, attribution)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
