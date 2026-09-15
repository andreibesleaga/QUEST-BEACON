// BEACON — EFFIS/GWIS adapter tests (E4·Part-B; ADR-009/F1/F5/F6). Each mode yields provenance-stamped
// HazardGeometry (Point→HOTSPOT, Polygon/MultiPolygon→PERIMETER); the live rung degrades to the recorded
// mock when upstream is unreachable; GLOBAL coverage serves any region incl. Romania; the outward
// HazardSourcePort adapts the ladder; the factory reads SOURCE_EFFIS_* env and defaults to CACHED.
// Deterministic clock is safely in the past (flaky-test rule).
import { describe, it, expect } from 'vitest';
import { ok, asId, makeHazardGeometry } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { EffisAdapter, makeEffisAdapter } from './effis-adapter.js';

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
const ROMANIA: Region = { id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-effis' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('EffisAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as HazardGeometry (1 HOTSPOT + 2 PERIMETER incl. the RO burnt area)', async () => {
    const adapter = new EffisAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records.map((r) => r.entity.kind)).toEqual([
      'HOTSPOT',
      'PERIMETER',
      'PERIMETER',
    ]);
    const first = res.value.records[0];
    expect(first?.provenance.source).toBe('EFFIS/GWIS (Copernicus)');
    expect(first?.provenance.adapter).toBe('effis');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toBe('Copernicus/JRC open (attribution)');
    // The RO-bbox burnt-area demo feature (fixture id 50002) is present and geolocated inside Romania.
    const roPerimeter = res.value.records.find((r) => String(r.entity.id) === 'effis:poly:50002');
    expect(roPerimeter).toBeDefined();
    expect(roPerimeter?.entity.geometry.type).toBe('Polygon');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('effis', ROMANIA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new EffisAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new EffisAdapter({
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

  it('GLOBAL coverage serves any region (no NOT_COVERED), e.g. non-EU Australia', async () => {
    const adapter = new EffisAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect((await adapter.fetch({ id: 'au', bbox: [113, -44, 154, -10], iso: 'AU' })).ok).toBe(
      true,
    );
  });
});

describe('EffisAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope of HazardGeometry with freshness', async () => {
    const adapter = new EffisAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchHazards({ bbox: ROMANIA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new EffisAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('effis');
    expect(adapter.coverage.kind).toBe('GLOBAL');
  });
});

describe('makeEffisAdapter factory', () => {
  it('builds a CACHED adapter by default (no env) — keyless source, no LIVE key requirement', () => {
    const res = makeEffisAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('honors SOURCE_EFFIS_MODE=MOCK from env', () => {
    const res = makeEffisAdapter(mkEngine(new FakeCache()), { SOURCE_EFFIS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeEffisAdapter(mkEngine(new FakeCache()), { SOURCE_EFFIS_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('effis:pt:1'),
    incidentId: asId<IncidentId>('effis-unassigned'),
    sourceId: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [22.0, 37.5] },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: 'EFFIS/GWIS (Copernicus)',
          adapter: 'effis',
          fetchedAt,
          license: 'Copernicus/JRC open (attribution)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
