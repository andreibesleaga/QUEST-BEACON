// BEACON — GloFAS adapter tests (WP A11; ADR-009/F1/F5/F6). Mode-switch (MOCK/CACHED/LIVE) each yields a
// usable Gauge with the right mode/degraded/freshness; CACHED with an empty cache degrades to the recorded
// mock (never a dead-end); the live rung degrades to the mock when the WMS endpoint is unreachable; a LIVE
// adapter with no configured watch point in the region degrades WITHOUT charging the circuit breaker for a
// configuration gap; provenance is stamped; the outward FloodGaugePort adapts the ladder; coverage is
// GLOBAL. Deterministic clock fixed in the past, recorded fixtures only — no live network in this file.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Gauge, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import {
  GlofasAdapter,
  makeGlofasAdapter,
  parseGlofasWatchPoints,
  glofasPointsInRegion,
} from './glofas-adapter.js';

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
  new RedundancyEngine({ cache, nowIso: () => '2026-09-10T06:00:00Z', idGen: () => 'sid-glofas' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});
// An unroutable port: the live rung must fail fast and degrade, never hang or dead-end.
const DEAD_ENDPOINT = 'http://127.0.0.1:9/glofas-ows/ows.py';

describe('GlofasAdapter mode-switch', () => {
  it('MOCK mode serves the recorded GetFeatureInfo responses as Gauge (degraded, provenance MOCK)', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    // REGION-SCOPED (changed 2026-09-11). This previously asserted all FOUR recorded points for Romania,
    // which locked in the defect the new 'region-scoped' suite below documents: the fixtures are recorded
    // from a GLOBAL service and span continents, so replaying them wholesale put foreign rivers on the RO
    // map. Only the Siret point is in Romania, so only the Siret point belongs in this answer.
    expect(res.value.records).toHaveLength(1);
    expect(res.value.records.map((r) => r.entity.id)).toEqual([
      'glofas:SI001084', // Siret at Lungoci, Romania — the RO demo region's real reporting point
    ]);
    expect(res.value.records[0]?.entity.floodCategory).toBe('NONE'); // recorded "Inactive"
    expect(res.value.records[0]?.provenance.source).toBe('Copernicus GloFAS');
    expect(res.value.records[0]?.provenance.adapter).toBe('glofas');
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('glofas', region.id), seedFetchResult('2026-09-10T04:00:00Z'));
    const adapter = new GlofasAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-09-10T04:00:00Z');
  });

  it('CACHED mode with an empty cache degrades to the recorded mock (never a dead-end, Art. XVI)', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode degrades to the recorded mock when the WMS endpoint is unreachable (F5 → OP3)', async () => {
    const adapter = new GlofasAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: DEAD_ENDPOINT }),
      watchPoints: [{ lon: 27.9, lat: 45.4 }],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
    expect(adapter.health().consecutiveFailures).toBe(1); // a real upstream failure IS charged
  });

  it('LIVE mode with no watch point in the region degrades without charging the breaker', async () => {
    // WMS GetFeatureInfo can only interrogate a KNOWN coordinate (it cannot enumerate a bbox), so "no
    // point configured here" is a configuration gap, not an upstream outage — the breaker must not open.
    const cache = new FakeCache();
    cache.store.set(cacheKey('glofas', region.id), seedFetchResult('2026-09-10T04:00:00Z'));
    const adapter = new GlofasAdapter({
      engine: mkEngine(cache),
      config: cfg('LIVE', { url: DEAD_ENDPOINT }),
      watchPoints: [{ lon: -85.279, lat: 35.087 }], // Chattanooga: outside the Romania bbox
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.health().consecutiveFailures).toBe(0);
  });

  it('names the configuration gap in the degradation line instead of a phantom cold cache', async () => {
    const reasons: string[] = [];
    const engine = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-09-10T05:00:00Z',
      idGen: () => 'sid-glofas',
      onDegrade: (e) => reasons.push(e.reason),
    });
    const adapter = new GlofasAdapter({
      engine,
      config: cfg('LIVE', { url: DEAD_ENDPOINT }),
      watchPoints: [{ lon: -85.279, lat: 35.087 }], // outside the Romania bbox
    });
    await adapter.fetch(region);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("no SOURCE_GLOFAS_POINTS reporting point lies inside region 'ro'");
    expect(reasons[0]).toContain('1 configured');
  });
});

describe('GlofasAdapter outward FloodGaugePort', () => {
  it('fetchGauges returns a Sourced envelope of Gauge with freshness', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchGauges({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // One, not four: the outward port answers for the QUERIED bbox (Romania), and only the Siret point
    // is inside it. See the 'region-scoped' suite below for why this changed on 2026-09-11.
    expect(res.value.data).toHaveLength(1);
    expect(res.value.freshness.fetchedAt).toBe('2026-09-10T06:00:00Z');
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

describe('watch points (SOURCE_GLOFAS_POINTS)', () => {
  it('parses a semicolon-separated lon,lat list', () => {
    const res = parseGlofasWatchPoints(' 27.9457,45.4353 ; -85.279,35.087 ');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([
      { lon: 27.9457, lat: 45.4353 },
      { lon: -85.279, lat: 35.087 },
    ]);
  });

  it('treats an unset or empty list as "no live watch points"', () => {
    for (const raw of [undefined, '', '   ']) {
      const res = parseGlofasWatchPoints(raw);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toEqual([]);
    }
  });

  it('fails fast (CONFIG) on a malformed or out-of-range entry rather than probing a wrong pixel', () => {
    for (const raw of ['27.9', '27.9,45.4,1', 'x,45.4', '181,0', '0,-91']) {
      const res = parseGlofasWatchPoints(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe('CONFIG');
    }
  });

  it('keeps only the points inside the requested region bbox [west,south,east,north]', () => {
    const points = [
      { lon: 27.9457, lat: 45.4353 }, // inside Romania
      { lon: -85.279, lat: 35.087 }, // Chattanooga
      { lon: 20, lat: 43 }, // exactly on the south-west corner: inside
    ];
    expect(glofasPointsInRegion(points, region.bbox)).toEqual([points[0], points[2]]);
  });
});

describe('makeGlofasAdapter factory', () => {
  it('builds a CACHED adapter by default from env', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO api key — the strict-WMS endpoint is keyless (verified 2026-09-10)', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), {
      SOURCE_GLOFAS_MODE: 'LIVE',
      SOURCE_GLOFAS_POINTS: '27.9457,45.4353',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on a malformed SOURCE_GLOFAS_POINTS list', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), { SOURCE_GLOFAS_POINTS: 'nope' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_GLOFAS_MODE', () => {
    const res = makeGlofasAdapter(mkEngine(new FakeCache()), { SOURCE_GLOFAS_MODE: 'SOMETIMES' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
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

// ── The mock rung must respect the region, exactly as the LIVE rung does ────────────────────────────
//
// Found 2026-09-11 while re-recording the B1.8 characterisation snapshots. `fetch()` filters the LIVE
// watch points to the region bbox (`glofasPointsInRegion`), but `loadMock()` replayed EVERY recorded
// fixture regardless of where the region is. GloFAS is a GLOBAL service, so its recorded responses are
// deliberately spread across continents — which meant that whenever the live rung was unavailable, the
// Romanian common operating picture rendered flood gauges in Tibet, Alaska and Tennessee.
//
// That is not a cosmetic defect. The degraded rung is exactly when an operator is most dependent on the
// picture being trustworthy, and a gauge 6,000 km outside the region is not a degraded reading — it is a
// wrong one. Art. XVI says degrade and LABEL; it does not license answering a different question.
describe('GlofasAdapter — the recorded mock rung is region-scoped', () => {
  it('serves only the recorded points that fall inside the region bbox', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region); // Romania: [20, 43, 30, 48]
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records.map((r) => r.entity.id)).toEqual(['glofas:SI001084']);
  });

  it('serves the recorded points of a DIFFERENT region when that region is asked for', async () => {
    // The same fixture set, a different question: the Tennessee point is real and correctly placed HERE.
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'us-se', bbox: [-90, 30, -80, 40] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records.map((r) => r.entity.id)).toEqual(['glofas:SI001473']);
  });

  it('a region with no recorded point serves NOTHING rather than someone else’s river', async () => {
    const adapter = new GlofasAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'empty-ocean', bbox: [-30, -10, -20, 0] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // An empty gauge list is honest: "no flood gauge covers this area". A foreign gauge would be a lie
    // that reads as data, and the UI presents an empty layer as a designed state (plan §7 risk 5).
    expect(res.value.records).toHaveLength(0);
  });
});
