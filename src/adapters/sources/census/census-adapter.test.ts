// BEACON — Census adapter tests (E4·T-1xx; PopulationPort P12/ADR-009/F1/F5/F6). Mode-switch (mock/
// cached/live) each yields usable per-county PopulationEstimate records with the correct mode/degraded/
// freshness; the live rung degrades to the recorded mock when upstream is unreachable; LIVE without
// CENSUS_API_KEY fails fast (CONFIG) — Census refuses keyless requests (see fixture provenance note
// below); COUNTRIES=['US'] gates coverage; the outward PopulationPort.estimatePopulation sums the
// counties whose centroid falls inside the queried bbox; the factory reads SOURCE_CENSUS_* env.
import { describe, it, expect } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { CensusAdapter, makeCensusAdapter } from './census-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt (flaky-test rule)
const CA_COUNTIES: Region = { id: 'ca-counties', bbox: [-124.5, 32.5, -114.0, 42.1], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-census' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CensusAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as per-county PopulationEstimate (degraded, provenance MOCK)', async () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(CA_COUNTIES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5); // 5 builtin-known CA counties
    const first = res.value.records[0];
    expect(typeof first?.entity.count).toBe('number');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('US Census Bureau (ACS 5-year)');
    expect(first?.provenance.license).toBe('US public domain');
    expect(first?.provenance.adapter).toBe('census');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('census', CA_COUNTIES.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new CensusAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(CA_COUNTIES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new CensusAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/data/2022/acs/acs5', apiKey: 'k' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(CA_COUNTIES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES=[US] coverage rejects a non-US region with NOT_COVERED (OP4)', async () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('CensusAdapter outward PopulationPort', () => {
  it('estimatePopulation sums the counties whose centroid falls inside a "north" query bbox (Butte+Glenn+Sutter)', async () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const north: [number, number, number, number] = [-122.6, 39.0, -121.0, 40.0];
    const res = await adapter.estimatePopulation(north);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Butte 208368 + Glenn 28184 + Sutter 99981
    expect(res.value.data.count).toBe(208368 + 28184 + 99981);
    expect(res.value.data.area).toEqual(north);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('estimatePopulation sums a different "south" query bbox (Sacramento+Yolo)', async () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const south: [number, number, number, number] = [-122.2, 38.3, -121.0, 38.9];
    const res = await adapter.estimatePopulation(south);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(1584000 + 216350);
  });

  it('estimatePopulation returns count 0 for a bbox with no matching county (never an error)', async () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const empty: [number, number, number, number] = [10, 10, 11, 11]; // middle of the Atlantic
    const res = await adapter.estimatePopulation(empty);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(0);
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new CensusAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('census');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeCensusAdapter factory', () => {
  it('builds a CACHED adapter from env (default mode)', () => {
    const res = makeCensusAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter when SOURCE_CENSUS_MODE=MOCK', () => {
    const res = makeCensusAdapter(mkEngine(new FakeCache()), { SOURCE_CENSUS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) when LIVE mode lacks CENSUS_API_KEY', () => {
    const res = makeCensusAdapter(mkEngine(new FakeCache()), { SOURCE_CENSUS_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('builds a LIVE adapter when CENSUS_API_KEY is present', () => {
    const res = makeCensusAdapter(mkEngine(new FakeCache()), {
      SOURCE_CENSUS_MODE: 'LIVE',
      CENSUS_API_KEY: 'test-key',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<PopulationEstimate> {
  const entity: PopulationEstimate = { area: [-121.7, 39.56, -121.5, 39.76], count: 208368 };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          source: 'US Census Bureau (ACS 5-year)',
          adapter: 'census',
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
