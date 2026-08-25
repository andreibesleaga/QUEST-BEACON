// BEACON — OSM Overpass adapter tests (adapter-contract §6, ADR-009/F1/F5/F6, InfrastructurePort P4).
// Mode-switch (mock/cached/live) each yields usable InfrastructureNode with the correct mode/degraded/
// freshness; the live rung degrades to the recorded mock when upstream is unreachable; GLOBAL coverage
// serves any region; the outward InfrastructurePort.fetchNodes adapts the ladder to the Sourced envelope;
// the factory defaults to CACHED (rate-limited upstream, Art. XVI) and fails fast on a bad mode.
import { describe, it, expect } from 'vitest';
import { ok, asId, makeInfrastructureNode } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { InfrastructureNode, InfrastructureNodeId, SourceId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { OsmOverpassAdapter, buildOverpassQuery, makeOsmOverpassAdapter } from './osm-overpass-adapter.js';

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
const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42] };
const mkEngine = (cache: CachePort) => new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-osm' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('OsmOverpassAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as InfrastructureNode (degraded, provenance MOCK)', async () => {
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records.map((r) => r.entity.type)).toEqual(['HOSPITAL', 'POWER', 'CELL']);
    const first = res.value.records[0];
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('OSM Overpass');
    expect(first?.provenance.license).toBe('© OpenStreetMap contributors (ODbL)');
    expect(first?.provenance.adapter).toBe('osm-overpass');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('osm-overpass', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 -> OP3)', async () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/interpreter' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('GLOBAL coverage serves any region (no NOT_COVERED)', async () => {
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect((await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' })).ok).toBe(true);
  });
});

describe('OsmOverpassAdapter outward InfrastructurePort', () => {
  it('fetchNodes returns a Sourced envelope of InfrastructureNode with freshness', async () => {
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNodes({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.data[0]?.type).toBe('HOSPITAL');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker before any failure and correct identity', () => {
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('osm-overpass');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('buildOverpassQuery', () => {
  it('swaps domain BBox order [west,south,east,north] to Overpass bbox order (south,west,north,east)', () => {
    const q = buildOverpassQuery([-124, 32, -114, 42]);
    expect(q).toContain('(32,-124,42,-114)');
  });

  it('includes all four node filters (hospital, fire_station, substation, comms mast x2)', () => {
    const q = buildOverpassQuery([-124, 32, -114, 42]);
    expect(q).toContain('["amenity"="hospital"]');
    expect(q).toContain('["amenity"="fire_station"]');
    expect(q).toContain('["power"="substation"]');
    expect(q).toContain('["man_made"="mast"]["tower:type"="communication"]');
    expect(q).toContain('["man_made"="mast"]["communication"]');
    expect(q.startsWith('[out:json][timeout:25];(')).toBe(true);
    expect(q.endsWith(');out body;')).toBe(true);
  });
});

describe('makeOsmOverpassAdapter factory', () => {
  it('defaults to CACHED mode when SOURCE_OSM_OVERPASS_MODE is unset (rate-limited upstream, cache aggressively)', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), { SOURCE_OSM_OVERPASS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), { SOURCE_OSM_OVERPASS_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('honors SOURCE_OSM_OVERPASS_URL override', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'MOCK',
      SOURCE_OSM_OVERPASS_URL: 'https://overpass.private.example/api/interpreter',
    });
    expect(res.ok).toBe(true);
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<InfrastructureNode> {
  const entity = makeInfrastructureNode({
    id: asId<InfrastructureNodeId>('osm:node:1'),
    type: 'POWER',
    status: 'ONLINE',
    geom: { type: 'Point', coordinates: [-121.61, 39.72] },
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'OSM Overpass',
          adapter: 'osm-overpass',
          fetchedAt,
          license: '© OpenStreetMap contributors (ODbL)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
