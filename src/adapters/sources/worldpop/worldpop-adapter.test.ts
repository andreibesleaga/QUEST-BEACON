// BEACON — WorldPop adapter tests (E4·T-worldpop; ADR-009/F1/F5/F6, PopulationPort P12). Mode-switch
// (mock/cached/live) each yields a usable PopulationEstimate with the correct mode/degraded/freshness; the
// live rung degrades to the recorded mock when upstream is unreachable; provenance is stamped on every
// record; the outward PopulationPort.estimatePopulation adapts the ladder to the Sourced envelope; the
// factory fails fast on bad config and defaults to CACHED (DATA_SOURCE_VERIFICATION population row).
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { WorldPopAdapter, makeWorldPopAdapter } from './worldpop-adapter.js';

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

// The same Butte-County-ish bbox the recorded fixture was captured against (see worldpop-adapter.ts header).
const region: Region = { id: 'butte', bbox: [-121.9, 39.4, -121.35, 39.85] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-15T09:02:34Z', idGen: () => 'sid-worldpop' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('WorldPopAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as a PopulationEstimate (degraded, provenance MOCK)', async () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(1);
    const first = res.value.records[0];
    expect(first?.entity.area).toEqual(region.bbox);
    expect(first?.entity.count).toBe(215183);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('WorldPop');
    expect(first?.provenance.license).toBe('CC BY 4.0');
    expect(first?.provenance.adapter).toBe('worldpop');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('worldpop', region.id), seedFetchResult('2026-07-15T08:00:00Z'));
    const adapter = new WorldPopAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-15T08:00:00Z');
    expect(res.value.records[0]?.entity.count).toBe(200000);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/v1/services/stats' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(1);
    expect(res.value.records[0]?.entity.count).toBeGreaterThan(0);
  });
});

describe('WorldPopAdapter outward PopulationPort', () => {
  it('estimatePopulation returns a Sourced PopulationEstimate with a numeric count and freshness', async () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation(region.bbox);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.area).toEqual(region.bbox);
    expect(typeof res.value.data.count).toBe('number');
    expect(res.value.data.count).toBeGreaterThan(0);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-15T09:02:34Z');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('worldpop');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeWorldPopAdapter factory', () => {
  it('defaults to CACHED mode from env (DATA_SOURCE_VERIFICATION population row)', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('honours SOURCE_WORLDPOP_MODE from env', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), { SOURCE_WORLDPOP_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_WORLDPOP_MODE', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), { SOURCE_WORLDPOP_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<PopulationEstimate> {
  const entity: PopulationEstimate = { area: region.bbox, count: 200000 };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'WorldPop',
          adapter: 'worldpop',
          fetchedAt,
          license: 'CC BY 4.0',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
