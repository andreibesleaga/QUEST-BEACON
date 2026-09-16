// BEACON — GDACS adapter tests (E4·T-171; ADR-009/F1/F5/F6). Each mode yields provenance-stamped
// HazardGeometry (WF+FL, EQ filtered out); the live rung degrades to the recorded mock when upstream is
// unreachable; GLOBAL coverage serves any region; the outward HazardSourcePort adapts the ladder; the
// factory reads SOURCE_GDACS_* env. Deterministic clock is safely in the past (flaky-test rule).
import { describe, it, expect } from 'vitest';
import { ok, asId, makeHazardGeometry } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { GdacsAdapter, makeGdacsAdapter } from './gdacs-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt
const ROMANIA: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-gdacs' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('GdacsAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as HazardGeometry (WF+FL only; EQ filtered)', async () => {
    const adapter = new GdacsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    expect(res.value.records.map((r) => r.entity.kind)).toEqual([
      'HOTSPOT',
      'FLOOD_REACH',
      'HOTSPOT',
      'HOTSPOT',
    ]);
    const first = res.value.records[0];
    expect(first?.provenance.source).toBe('GDACS');
    expect(first?.provenance.adapter).toBe('gdacs');
    expect(first?.provenance.mode).toBe('MOCK');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('gdacs', ROMANIA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new GdacsAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new GdacsAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('GLOBAL coverage serves any region (no NOT_COVERED)', async () => {
    const adapter = new GdacsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect((await adapter.fetch({ id: 'au', bbox: [113, -44, 154, -10], iso: 'AU' })).ok).toBe(
      true,
    );
  });
});

describe('GdacsAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope of HazardGeometry with freshness', async () => {
    const adapter = new GdacsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchHazards({ bbox: ROMANIA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new GdacsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('gdacs');
    expect(adapter.coverage.kind).toBe('GLOBAL');
  });
});

describe('makeGdacsAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeGdacsAdapter(mkEngine(new FakeCache()), { SOURCE_GDACS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeGdacsAdapter(mkEngine(new FakeCache()), { SOURCE_GDACS_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('gdacs:WF:1234567:1'),
    incidentId: asId<IncidentId>('gdacs-unassigned'),
    sourceId: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [-121.5, 39.8] },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'GDACS',
          adapter: 'gdacs',
          fetchedAt,
          license: 'GDACS open data (JRC / UN-OCHA)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
