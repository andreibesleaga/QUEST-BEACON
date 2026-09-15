// BEACON — HIFLD adapter tests (S2·Lane A3; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (MOCK/CACHED/LIVE)
// each yields usable InfrastructureNodes with the correct mode/degraded/freshness; the live rung issues one
// bbox query PER LAYER and degrades to the recorded bodies when the service is unreachable (including the
// dead-service response the old HIFLD endpoint returns today); provenance is stamped on every record; the
// US coverage gate refuses an RO query. NO live network: `fetch` is stubbed in every LIVE test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { InfrastructureNode, InfrastructureNodeId, SourceId } from '@/domain/index.js';
import { asId, makeInfrastructureNode } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { HIFLD_LAYERS } from './hifld-acl.js';
import { HifldAdapter, makeHifldAdapter } from './hifld-adapter.js';

const NOW = '2026-07-05T22:00:00Z'; // fixed clock — no wall-clock dependence anywhere in this suite
const SOURCE_LABEL = 'HIFLD lifelines (FEMA Region 9 public 2019 package)';
const LICENSE = 'US public domain (HIFLD / FEMA)';
const RECORDED_PER_LAYER = 4; // each recorded body was captured with resultRecordCount=4
const TOTAL_RECORDED = RECORDED_PER_LAYER * HIFLD_LAYERS.length;

const layerBody = (layerId: number): string =>
  readFileSync(
    fileURLToPath(new URL(`./__fixtures__/lifelines-${layerId}.geojson`, import.meta.url)),
    'utf8',
  );

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

// Butte County, CA — the bbox the recorded bodies were actually captured with.
const region: Region = { id: 'butte', bbox: [-121.95, 39.4, -121.35, 39.9], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-hifld' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

/** Stub the platform fetch with a per-URL responder — NO live network is ever reached in these tests. */
function stubFetch(responder: (url: string) => Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(String(url));
    return Promise.resolve(responder(String(url)));
  });
  return seen;
}

/** Serve each recorded layer body back for its own `/{layerId}/query` URL. */
const recordedLayerResponder = (url: string): Response => {
  const layer = /\/(\d+)\/query\?/.exec(url)?.[1];
  return new Response(layerBody(Number(layer)), { status: 200 });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HifldAdapter mode-switch', () => {
  it('MOCK mode serves every recorded layer as typed InfrastructureNodes (degraded, provenance MOCK)', async () => {
    const adapter = new HifldAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(TOTAL_RECORDED);
    // All five lifeline classes are present — the whole point of HIFLD beside osm-overpass.
    const types = new Set(res.value.records.map((r) => r.entity.type));
    expect([...types].sort()).toEqual(['CELL', 'HOSPITAL', 'NURSING_HOME', 'POWER', 'SHELTER']);
    const first = res.value.records[0];
    expect(first?.entity.type).toBe('HOSPITAL');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe(SOURCE_LABEL);
    expect(first?.provenance.license).toBe(LICENSE);
    expect(first?.provenance.adapter).toBe('hifld');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('hifld', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new HifldAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode issues ONE bbox GeoJSON query per configured layer', async () => {
    const seen = stubFetch(recordedLayerResponder);
    const adapter = new HifldAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://services.arcgis.com/x/FeatureServer' }),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(TOTAL_RECORDED);
    expect(seen).toHaveLength(HIFLD_LAYERS.length);
    expect(seen[0]).toContain('/10/query?');
    expect(seen[0]).toContain('geometry=-121.95%2C39.4%2C-121.35%2C39.9');
    expect(seen[0]).toContain('geometryType=esriGeometryEnvelope');
    expect(seen[0]).toContain('outSR=4326'); // WGS-84 back, not the service's native Web Mercator
    expect(seen[0]).toContain('f=geojson');
  });

  it('LIVE mode degrades to the recorded bodies when the service is unreachable (F5 → OP3)', async () => {
    stubFetch(() => new Response('Bad Request', { status: 400 }));
    const adapter = new HifldAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://services1.arcgis.com/dead/FeatureServer' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // service down, cache empty → recorded bodies, never a dead-end
    expect(res.value.records).toHaveLength(TOTAL_RECORDED);
  });

  it('a partial layer outage degrades the WHOLE fetch rather than silently dropping a lifeline class', async () => {
    // Layer 10 (hospitals) answers; layer 9 (nursing homes) 500s. A partial infrastructure picture missing
    // hospitals would be worse than a labelled degraded one, so the ladder falls back wholesale.
    stubFetch((url) =>
      url.includes('/9/query?')
        ? new Response('boom', { status: 500 })
        : recordedLayerResponder(url),
    );
    const adapter = new HifldAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://services.arcgis.com/x/FeatureServer' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records).toHaveLength(TOTAL_RECORDED);
  });
});

describe('HifldAdapter outward InfrastructurePort', () => {
  it('fetchNodes returns a Sourced envelope of InfrastructureNode with freshness', async () => {
    const adapter = new HifldAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNodes({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(TOTAL_RECORDED);
    expect(res.value.data[0]?.geom.type).toBe('Point');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('is US-only: a non-US region is refused NOT_COVERED rather than answered with US assets', async () => {
    const adapter = new HifldAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('surfaces a typed NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new HifldAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-hifld-fixtures',
    });
    const res = await adapter.fetchNodes({ bbox: region.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker and US COUNTRIES coverage before any failure', () => {
    const adapter = new HifldAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('hifld');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });

  it('honours a narrowed layer set and the per-layer feature cap', async () => {
    const seen = stubFetch(recordedLayerResponder);
    const adapter = new HifldAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://services.arcgis.com/x/FeatureServer' }),
      layers: [{ layerId: 10, type: 'HOSPITAL' }],
      maxFeaturesPerLayer: 25,
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(RECORDED_PER_LAYER);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('resultRecordCount=25');
  });
});

describe('makeHifldAdapter factory', () => {
  it('defaults to CACHED (the reachable data is a 2019 static package — an honest freshness label)', () => {
    const res = makeHifldAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key — the FEMA Region 9 service is public', () => {
    const res = makeHifldAdapter(mkEngine(new FakeCache()), { SOURCE_HIFLD_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_HIFLD_MODE', () => {
    const res = makeHifldAdapter(mkEngine(new FakeCache()), { SOURCE_HIFLD_MODE: 'archived' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<InfrastructureNode> {
  const entity = makeInfrastructureNode({
    id: asId<InfrastructureNodeId>('hifld:10:0004595926'),
    type: 'HOSPITAL',
    geom: { type: 'Point', coordinates: [-121.8476, 39.75456] },
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: SOURCE_LABEL,
          adapter: 'hifld',
          fetchedAt,
          license: LICENSE,
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
