// BEACON — FIRMS adapter tests (E4·T-150/T-152; FIRMS/ADR-009/F1/F5/F6). Mode-switch (mock/cached/live)
// each yields usable HazardGeometry with the correct mode/degraded/freshness; the live rung degrades to
// the recorded mock when upstream is unreachable; provenance is stamped on every record; the outward
// HazardSourcePort.fetchHazards adapts the ladder to the Sourced envelope; the factory fails fast.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { FirmsAdapter, makeFirmsAdapter } from './firms-adapter.js';

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
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-firms' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('FirmsAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as HOTSPOT HazardGeometry (degraded, provenance MOCK)', async () => {
    const adapter = new FirmsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('HOTSPOT');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('NASA FIRMS');
    expect(first?.provenance.license).toBe('NASA open / attribution requested');
    expect(first?.provenance.adapter).toBe('firms');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    const seeded = seedFetchResult('2026-07-05T20:00:00Z');
    cache.store.set(cacheKey('firms', region.id), seeded);
    const adapter = new FirmsAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new FirmsAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/area/csv', apiKey: 'k' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('FirmsAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope of HazardGeometry with freshness', async () => {
    const adapter = new FirmsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchHazards({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    expect(res.value.data[0]?.kind).toBe('HOTSPOT');
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new FirmsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('firms');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeFirmsAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeFirmsAdapter(mkEngine(new FakeCache()), { SOURCE_FIRMS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) when LIVE mode lacks FIRMS_MAP_KEY', () => {
    const res = makeFirmsAdapter(mkEngine(new FakeCache()), { SOURCE_FIRMS_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('firms:1'),
    incidentId: asId<IncidentId>('firms-unassigned'),
    sourceId: asId<SourceId>('sid-seed'),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [-122.6, 38.9] },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('33333333-3333-4333-8333-333333333333'),
          source: 'NASA FIRMS',
          adapter: 'firms',
          fetchedAt,
          license: 'NASA open / attribution requested',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}

// Region scoping of the OFFLINE rungs (2026-08-08). firms became a per-region guarantee — every zone gets
// one always-live wildfire source — which made a latent defect visible: the mock rung served the whole
// Californian fixture to whatever region asked, so Romania's map showed hotspots on the Californian coast.
// The live rung never had this problem (the bbox is in the URL). These pin both directions, because a
// filter proven only by its empty case would pass just as well if it dropped everything.
describe('FirmsAdapter mock rung is region-scoped', () => {
  const RO_BBOX: Region['bbox'] = [20.2, 43.6, 29.7, 48.3]; // Romania — contains no fixture row

  it('serves NO hotspots to a region the fixture does not cover (honest empty, not another region\'s fires)', async () => {
    const adapter = new FirmsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: RO_BBOX });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(0);
  });

  it('still serves the fixture hotspots to the region that DOES contain them', async () => {
    const adapter = new FirmsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records.length).toBeGreaterThan(0);
    for (const rec of res.value.records) {
      // FIRMS detections are points by construction (hotspots, never perimeters — see firms-acl.ts).
      const geometry = rec.entity.geometry;
      expect(geometry.type).toBe('Point');
      if (geometry.type !== 'Point') continue;
      const [lon, lat] = geometry.coordinates;
      expect(lon).toBeGreaterThanOrEqual(region.bbox[0]);
      expect(lon).toBeLessThanOrEqual(region.bbox[2]);
      expect(lat).toBeGreaterThanOrEqual(region.bbox[1]);
      expect(lat).toBeLessThanOrEqual(region.bbox[3]);
    }
  });
});
