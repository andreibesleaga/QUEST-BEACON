// BEACON — FEMA NRI adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (mock/cached/
// live) each yields usable PopulationEstimates with the correct mode/degraded/freshness; the live rung
// degrades to the recorded mock when upstream is unreachable (never a dead-end); the outward
// PopulationPort sums whole counties whose centroid falls in the query bbox; coverage is US-only; the
// factory is keyless. NO LIVE NETWORK: the live rung points at a closed local port.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { NriAdapter, makeNriAdapter } from './nri-adapter.js';

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

// The Butte-fire envelope the recorded fixture was captured for.
const butte: Region = { id: 'us-ca-butte', bbox: [-121.9, 39.4, -121.35, 39.85], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-nri' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('NriAdapter mode-switch', () => {
  it('MOCK mode serves the recorded response as PopulationEstimates (degraded, provenance MOCK)', async () => {
    const adapter = new NriAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(butte);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    const first = res.value.records[0];
    expect(first?.entity.count).toBe(211490); // Butte County, verbatim
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('FEMA National Risk Index (county table)');
    expect(first?.provenance.license).toBe('US public domain');
    expect(first?.provenance.adapter).toBe('nri');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('nri', butte.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new NriAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(butte);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new NriAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/FeatureServer/0/query' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(butte);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('returns NOT_COVERED for a non-US region rather than mislabelling it (OP4)', async () => {
    const adapter = new NriAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('NriAdapter outward PopulationPort', () => {
  it('sums the whole-county populations whose centroid falls inside the query bbox', async () => {
    const adapter = new NriAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation(butte.bbox);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The envelope-intersects server filter returned FOUR counties, but only Butte's CENTROID is inside
    // the envelope — Glenn/Plumas/Yuba merely overlap its edges. The sum is therefore Butte alone: the
    // centroid rule is what keeps a neighbouring county's whole population out of a small query area.
    expect(res.value.data.count).toBe(211490);
    expect(res.value.data.area).toEqual(butte.bbox);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('returns zero — not a guess — when no county centroid falls inside the bbox', async () => {
    const adapter = new NriAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation([-121.45, 39.7, -121.4, 39.75]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(0);
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new NriAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-nri-fixtures',
    });
    const res = await adapter.estimatePopulation(butte.bbox);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new NriAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('nri');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeNriAdapter factory', () => {
  it('defaults to CACHED (baseline table, not a live feed)', () => {
    const res = makeNriAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key (the FeatureServer is keyless)', () => {
    const res = makeNriAdapter(mkEngine(new FakeCache()), { SOURCE_NRI_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeNriAdapter(mkEngine(new FakeCache()), { SOURCE_NRI_MODE: 'risky' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<PopulationEstimate> {
  const entity: PopulationEstimate = { area: [-121.61, 39.65, -121.59, 39.67], count: 211490 };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('99999999-9999-4999-8999-999999999999'),
          source: 'FEMA National Risk Index (county table)',
          adapter: 'nri',
          fetchedAt,
          license: 'US public domain',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
