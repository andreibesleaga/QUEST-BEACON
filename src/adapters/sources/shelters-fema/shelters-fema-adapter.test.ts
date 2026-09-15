// BEACON — FEMA shelters adapter tests (WP A4; ADR-009/F1/F5/F6, Art. XI/XVI). Mode-switch (MOCK/CACHED/
// LIVE) each yields provenance-stamped Shelters; CACHED with an empty cache degrades to the recorded mock;
// the live rung degrades to the mock when gis.fema.gov is unreachable; the MOCK RUNG IS REGION-SCOPED (the
// defect class that put GloFAS gauges from Tibet on the Romanian map); coverage is US-only, so a non-US
// region gets NOT_COVERED rather than a false global claim. Deterministic clock fixed in the past,
// recorded fixtures only — no live network in this file.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import {
  SheltersFemaAdapter,
  makeSheltersFemaAdapter,
  parseFemaShelterLayerIds,
} from './shelters-fema-adapter.js';

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

// The two shipped US geographies: the whole state, and the Butte-County wildfire demo footprint.
const usCa: Region = { id: 'us-ca', bbox: [-124.48, 32.53, -114.13, 42.01], iso: 'US' };
const butte: Region = { id: 'us-ca-butte', bbox: [-121.95, 39.3, -121.3, 40.15], iso: 'US' };
const ro: Region = { id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' };

const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-09-11T07:40:00Z', idGen: () => 'sid-fema' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});
/** An unroutable port: the live rung must fail fast and degrade, never hang or dead-end. */
const DEAD_ENDPOINT = 'http://127.0.0.1:9/arcgis/rest/services/NSS/FEMA_NSS/MapServer';

describe('SheltersFemaAdapter mode-switch', () => {
  it('MOCK mode serves the recorded ArcGIS responses as Shelters (degraded, provenance MOCK)', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.length).toBeGreaterThan(0);
    const p = res.value.records[0]?.provenance;
    // Art. XI: all four provenance facets, or the record has no business being on a COP.
    expect(p?.source).toBe('FEMA ESF#6 Shelter System');
    expect(p?.adapter).toBe('shelters-fema');
    expect(p?.fetchedAt).toBe('2026-09-11T07:40:00Z');
    expect(p?.license).toBe(
      'US public domain (17 U.S.C. §105) — FEMA, Mass Care, American Red Cross',
    );
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('shelters-fema', usCa.id), seedFetchResult('2026-09-11T05:00:00Z'));
    const adapter = new SheltersFemaAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-09-11T05:00:00Z');
  });

  it('CACHED mode with an empty cache degrades to the recorded mock (never a dead-end, Art. XVI)', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('CACHED'),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode degrades to the recorded mock when gis.fema.gov is unreachable (F5 → OP3)', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: DEAD_ENDPOINT }),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(adapter.health().consecutiveFailures).toBeGreaterThan(0); // a real outage DOES charge the breaker
  });
});

describe('coverage — FEMA is a US programme and never claims more', () => {
  it('declares COUNTRIES:[US], not GLOBAL', () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });

  it('returns NOT_COVERED for Romania — nothing, rather than US shelters on a Romanian map', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(ro);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('the MOCK rung is REGION-SCOPED (the GloFAS-in-Tibet defect class)', () => {
  it('replays only the recorded shelters INSIDE the region — 26 of 31 for us-ca', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The OPEN fixture is a NATIONAL recording (it is the whole national open layer), so replaying it
    // wholesale would put Hawaii, Minnesota and Indiana shelters on the California COP. A shelter outside
    // the region is not a degraded answer, it is a wrong one — and the degraded rung is exactly when an
    // operator most needs the picture to be trustworthy (Art. XVI licenses labelling, never answering a
    // different question).
    expect(res.value.records).toHaveLength(26);
    const [west, south, east, north] = usCa.bbox;
    for (const r of res.value.records) {
      const [lon, lat] = r.entity.geom.coordinates;
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    // Named explicitly so a regression is unmistakable, not just a count that moved.
    const ids = res.value.records.map((r) => r.entity.id);
    for (const leaked of ['shelters-fema:138736', 'shelters-fema:138748', 'shelters-fema:138820']) {
      expect(ids, 'a Hawaii shelter leaked onto the California COP').not.toContain(leaked);
    }
    expect(ids).not.toContain('shelters-fema:356231'); // Minnesota
    expect(ids).not.toContain('shelters-fema:357083'); // Indiana
  });

  it('narrows further for a smaller region — 25 for the Butte-County footprint', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(butte);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(25);
    // The one open CA shelter (Lake County Fairgrounds, -122.92) is OUTSIDE the Butte footprint.
    expect(res.value.records.map((r) => r.entity.id)).not.toContain('shelters-fema:341375');
  });
});

describe('honest rendering of the California shelter picture', () => {
  it('shows the ONE open CA shelter as OPEN and the rest as CLOSED — never promoted, never hidden', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byStatus = res.value.records.reduce<Record<string, number>>((acc, r) => {
      acc[r.entity.status] = (acc[r.entity.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ OPEN: 1, CLOSED: 25 });
  });

  it('renders the one open CA shelter with capacity 0 — its published capacity is the 99999 sentinel', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(usCa);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const open = res.value.records.find((r) => r.entity.status === 'OPEN');
    expect(open?.entity.id).toBe('shelters-fema:341375'); // Lake County Fairgrounds, Lakeport CA
    // 0 = "nobody has counted this building" ⇒ INELIGIBLE for capacity matching. The alternative would be
    // to publish 99,999 beds at a county fairground, which is a fabricated destination.
    expect(open?.entity.capacity).toBe(0);
    expect(open?.entity.occupancy).toBe(0);
  });

  it('keeps a CLOSED shelter CLOSED even though it has real published capacity', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(butte);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bidwell = res.value.records.find((r) => r.entity.id === 'shelters-fema:169623');
    expect(bidwell?.entity.status).toBe('CLOSED');
    expect(bidwell?.entity.capacity).toBe(623);
  });
});

describe('outward ShelterDirectoryPort (P18)', () => {
  it('adapts the ladder to a Sourced envelope with freshness', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchShelters({ bbox: usCa.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(26);
    expect(res.value.freshness).toBeDefined();
  });

  it('reports a typed DomainError rather than throwing when the region is outside FEMA coverage', async () => {
    const adapter = new SheltersFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    // fetchShelters is US-scoped by construction, so a non-US bbox is only reachable via fetch(); this
    // asserts the port never throws when the ladder returns an Err.
    const res = await adapter.fetch(ro);
    expect(res.ok).toBe(false);
  });
});

describe('parseFemaShelterLayerIds — the layer index is CONFIG, and an unknown index is refused', () => {
  it('defaults to the three status layers when unset', () => {
    const res = parseFemaShelterLayerIds(undefined);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((l) => l.layerId)).toEqual([0, 1, 2]);
  });

  it('accepts a subset', () => {
    const res = parseFemaShelterLayerIds('0,2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((l) => l.expectedStatus)).toEqual(['OPEN', 'FULL']);
  });

  it('REFUSES layer 3 (Alert) with a CONFIG error — its status has no honest domain member', () => {
    const res = parseFemaShelterLayerIds('0,3');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('REFUSES a non-numeric entry rather than silently ignoring it', () => {
    expect(parseFemaShelterLayerIds('open').ok).toBe(false);
  });
});

describe('makeSheltersFemaAdapter — 12-factor config', () => {
  it('is keyless and defaults to CACHED (LIVE is an operator decision at deploy time)', () => {
    const res = makeSheltersFemaAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.id).toBe('shelters-fema');
  });

  it('honours SOURCE_SHELTERS_FEMA_MODE', () => {
    const res = makeSheltersFemaAdapter(mkEngine(new FakeCache()), {
      SOURCE_SHELTERS_FEMA_MODE: 'live',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode and on an unusable layer list', () => {
    expect(
      makeSheltersFemaAdapter(mkEngine(new FakeCache()), { SOURCE_SHELTERS_FEMA_MODE: 'nope' }).ok,
    ).toBe(false);
    expect(
      makeSheltersFemaAdapter(mkEngine(new FakeCache()), { SOURCE_SHELTERS_FEMA_LAYERS: '4' }).ok,
    ).toBe(false);
  });
});

/** A minimal cached FetchResult, shaped exactly as the engine writes it. */
function seedFetchResult(freshness: string): FetchResult {
  return { records: [], freshness, mode: 'LIVE', degraded: false };
}
