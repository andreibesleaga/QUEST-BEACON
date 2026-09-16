// BEACON — live-seed bridge tests (Phase-B B1 + Phase-D W2a; Art. XVI redundancy ladder, F1 provenance).
// Proves the adapter→derivation-input bridge: a served source REPLACES its seed slice; an unserved/down/
// NOT_COVERED source RETAINS the seeded/cached slice and NEVER empties it (Art. XVI); provenance is non-empty
// and mode-labelled (LIVE/CACHED/MOCK, never fabricated). Phase-D adds the new registry ids as consumers:
// osm-overpass (infrastructure), worldpop/census (exposed population), eagle-i (outage AOI + ASSUMED-offline
// node ids), opencellid (cell sites), nfhl (flood zones), open-meteo (wind glyph obs), and the news/intel set
// (gdelt/reliefweb/agency-rss/bluesky/meteoalarm-ro) + the previously-built-not-consumed nws + gdacs — all
// routed through collectProvenance so GET /status reflects them. Deterministic: all adapters MOCK/stubbed,
// fixed clock/idGen, NO network.
import { describe, it, expect } from 'vitest';
import { makeInMemoryCache } from '@/adapters/cache/in-memory-cache.js';
import type { SourceAdapterPort, SourceMode } from '@/adapters/_shared/index.js';
import type { SourceRecord } from '@/domain/source-record.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  HazardGeometryId,
  IncidentId,
  RegionId,
  SourceId,
} from '@/domain/value-objects/ids.js';
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import type { OutageRecord } from '@/ports/infrastructure-sources.js';
import { loadRegionRegistry } from '@/adapters/persistence/region-registry.js';
import { DEFAULT_SEED } from './seed.js';
import { DEFAULT_MAP_SEED } from './map-seed.js';
import { buildAdapterRegistry, loadManifest } from './adapter-registry.js';
import { focusOf, assembleLiveCoreSeed, assembleLiveMapSeed } from './live-seed.js';

const NOW = '2026-07-05T22:00:00Z';
const clock = (): string => NOW;
const fixed = {
  nowIso: clock,
  idGen: ((): (() => string) => {
    let n = 0;
    return () => `sr-${++n}`;
  })(),
};
// The full manifest id set — all forced MOCK so the whole assembly is deterministic + offline (no network).
const ALL_IDS = [
  'firms',
  'nws',
  'nwps',
  'glofas',
  'gdacs',
  'meteoalarm-ro',
  'open-meteo',
  'usgs-water',
  'gdelt',
  'reliefweb',
  'agency-rss',
  'bluesky',
  'mastodon',
  'metno',
  'anm',
  'hdxpop',
  'hifld',
  'eonet',
  'cemsrm',
  'openfema',
  'caphub',
  'lanceflood',
  'nri',
  'nifc',
  'effis',
  'osm-overpass',
  'worldpop',
  'census',
  'nfhl',
  'eagle-i',
  'opencellid',
  'itu',
  'camara-gsma',
  // E11 camera sources — caltrans-cctv defaults LIVE, so it MUST be forced MOCK or the enrich hits the network.
  'caltrans-cctv',
  'alertwildfire',
  'windy-webcams',
  'dot511',
  'cnadnr-ro',
  // MW-B aggregators (B3.1/B3.2): CACHED by manifest, so no fetchLive path — forced MOCK anyway for parity,
  // so this list stays the WHOLE manifest and a future LIVE-by-default row cannot sneak a network call in.
  'meteoalarm-gr',
  'meteoalarm-es',
  'wmo-swic',
  // S3 AirQuality trio — airnow + sensorcommunity default LIVE in the manifest, so forcing MOCK here is
  // load-bearing (a real network fetch otherwise), not parity cosmetics.
  'openaq',
  'airnow',
  'sensorcommunity',
  // WP A4 — the FEMA shelter directory (P18). CACHED by manifest, so it has no fetchLive path; forced MOCK
  // here for the same parity reason as the B3 aggregators, so this list stays the WHOLE manifest.
  'shelters-fema',
];
const ALL_MOCK: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_IDS.map((id) => [id, 'MOCK']),
);

function registry(overrides = ALL_MOCK): Map<string, SourceAdapterPort> {
  const res = buildAdapterRegistry({
    cache: makeInMemoryCache(),
    env: {},
    sourceModeOverrides: overrides,
    ...fixed,
  });
  if (!res.ok) throw new Error(`registry build failed: ${res.error.message}`);
  return res.value;
}

function regions() {
  const res = loadRegionRegistry();
  if (!res.ok) throw new Error('region registry failed');
  return res.value;
}

const srec = (id: string, mode: SourceMode): SourceRecord => ({
  id: asId<SourceId>(id),
  source: id,
  adapter: id,
  fetchedAt: NOW,
  license: 'test',
  mode,
});

/** Replace an adapter with a stub that SERVES the given entities (a real fetch, mode-labelled). */
function servedStub(
  base: SourceAdapterPort,
  entities: readonly unknown[],
  mode: SourceMode = 'MOCK',
): SourceAdapterPort {
  return {
    ...base,
    fetch: async () => ({
      ok: true,
      value: {
        records: entities.map((entity) => ({ entity, provenance: srec(base.id, mode) })),
        freshness: NOW,
        mode,
        degraded: mode !== 'LIVE',
      },
    }),
  };
}

/** Replace an adapter with a stub that is DOWN (primary unavailable) — the seed slice must survive. */
function downStub(base: SourceAdapterPort): SourceAdapterPort {
  return {
    ...base,
    fetch: async () => ({
      ok: false,
      error: { kind: 'UPSTREAM_UNAVAILABLE', message: 'down', retryable: true },
    }),
  };
}

/**
 * Replace an adapter with a stub serving its OWN recorded entities moved to `position`. Several fixtures
 * were recorded somewhere other than the region a test asks about (open-meteo in Bucharest, OpenAQ in
 * Washington), and since 2026-09-13 a recording from elsewhere is not served for the region — so a test
 * about what a served reading DOES must first put the reading where the region is.
 */
async function relocatedStub(
  base: SourceAdapterPort,
  position: readonly [number, number],
  mode?: SourceMode,
): Promise<SourceAdapterPort> {
  // Probed as California (with its ISO code) so a US-only source's coverage gate lets the fixture out.
  const res = await base.fetch({ id: 'us-ca', bbox: [-124.5, 32.5, -114.1, 42.0], iso: 'US' });
  if (!res.ok) throw new Error(`fixture for ${base.id} did not serve: ${res.error.message}`);
  const [lon, lat] = position;
  const square = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon, lat],
        [lon + 0.05, lat],
        [lon + 0.05, lat + 0.05],
        [lon, lat + 0.05],
        [lon, lat],
      ],
    ],
  };
  const moved = res.value.records.map((r) => {
    const entity = r.entity as Record<string, unknown>;
    return {
      ...entity,
      position,
      ...('geom' in entity ? { geom: square } : {}),
      ...('geometry' in entity ? { geometry: square } : {}),
    };
  });
  return servedStub(base, moved, mode ?? res.value.mode);
}

const caIncident = (seed: typeof DEFAULT_SEED) =>
  seed.incidents.find((i) => i.regionId === 'us-ca')!;
const roIncident = (seed: typeof DEFAULT_SEED) => seed.incidents.find((i) => i.regionId === 'ro')!;
const provIds = (refs: readonly { sourceId: string }[]) => refs.map((r) => r.sourceId);

describe('assembleLiveCoreSeed', () => {
  it('served sources REPLACE their slice (firms hazards + osm-overpass infra); adapter-less slices retained', async () => {
    const base = DEFAULT_SEED;
    const seed = await assembleLiveCoreSeed(registry(), regions(), base, clock);
    const live = caIncident(seed).derivation;
    const seeded = caIncident(base).derivation;
    // hazards + infrastructure now come from the adapters (mock fixtures) — DIFFERENT arrays than the seed.
    expect(live.hazards.length).toBeGreaterThan(0);
    expect(live.hazards).not.toBe(seeded.hazards);
    expect(live.infrastructure).not.toBe(seeded.infrastructure); // osm-overpass is now WIRED (was planned)
    expect(live.infrastructure.length).toBeGreaterThan(0);
    // hand-seeded slices with NO adapter are retained byte-for-byte.
    expect(live.buffers).toBe(seeded.buffers);
    expect(live.trendReadings).toBe(seeded.trendReadings);
  });

  it('worldpop/census REPLACE exposedPopulation when served; retained (3200) when population sources are down', async () => {
    const served = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    expect(typeof caIncident(served).derivation.exposedPopulation).toBe('number');
    // With census + worldpop DOWN, the S3 ladder continues: nri (county-table fallback rung, enabled
    // LAST on us-ca) serves and the grounding follows it — the fallback IS the feature (Art. XVI).
    const reg = registry();
    reg.set('worldpop', downStub(reg.get('worldpop')!));
    reg.set('census', downStub(reg.get('census')!));
    const viaNri = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    expect(String(caIncident(viaNri).derivation.populationGrounding!.sourceId)).toBe('nri');
    // Only with EVERY population rung down does the seeded planning number survive (never a dead-end).
    reg.set('nri', downStub(reg.get('nri')!));
    const down = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    expect(caIncident(down).derivation.exposedPopulation).toBe(
      caIncident(DEFAULT_SEED).derivation.exposedPopulation,
    );
  });

  it('CONSUMES nws + gdacs + the news/intel set (closes the built-not-consumed audit finding) into provenance', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const ids = provIds(caIncident(seed).provenance);
    for (const id of [
      'nws',
      'gdacs',
      'gdelt',
      'reliefweb',
      'agency-rss',
      'bluesky',
      'osm-overpass',
      'worldpop',
      'eagle-i',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('stores the served news batch on the incident seed (feeds IncidentView.news → SitRepFacts.news, W2c)', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const news = caIncident(seed).news;
    expect(news).toBeDefined();
    expect(news!.length).toBeGreaterThan(0);
    for (const n of news!) {
      expect(typeof n.title).toBe('string');
      expect(typeof n.url).toBe('string');
    }
  });

  it('builds non-empty, mode-labelled provenance (MOCK here, never fabricated as LIVE)', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const prov = caIncident(seed).provenance;
    expect(prov.length).toBeGreaterThan(0);
    expect(prov.every((p) => ['LIVE', 'CACHED', 'MOCK'].includes(p.mode))).toBe(true);
    expect(prov.some((p) => p.sourceId === 'firms' && p.mode === 'MOCK')).toBe(true);
  });

  it('refreshes the per-region sources projection (read by GET /status) from the enriched provenance', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const ca = caIncident(seed);
    const caSources = seed.sources['us-ca'] ?? [];
    expect(caSources.length).toBe(ca.provenance.length);
    expect(caSources.map((s) => `${s.sourceId}:${s.mode}`).sort()).toEqual(
      ca.provenance.map((p) => `${p.sourceId}:${p.mode}`).sort(),
    );
    expect(Object.keys(seed.sources)).toEqual(
      expect.arrayContaining(Object.keys(DEFAULT_SEED.sources)),
    );
  });

  it('a primary-down adapter falls back to the seeded slice + degraded label, never empties it', async () => {
    const reg = registry();
    // firms (hotspots) + nifc (perimeters) both down ⇒ the FULL seeded hazards slice must survive intact.
    reg.set('firms', downStub(reg.get('firms')!));
    reg.set('nifc', downStub(reg.get('nifc')!));
    reg.set('osm-overpass', downStub(reg.get('osm-overpass')!));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const live = caIncident(seed).derivation;
    // firms + nifc + osm-overpass down ⇒ hazards + infrastructure RETAINED from the seed, non-empty.
    expect(live.hazards).toEqual(caIncident(DEFAULT_SEED).derivation.hazards);
    expect(live.infrastructure).toBe(caIncident(DEFAULT_SEED).derivation.infrastructure);
    expect(caIncident(seed).provenance.length).toBeGreaterThan(0);
  });

  it('an adapter that THROWS (not returns Err) still degrades to the seeded slice, never breaks assembly', async () => {
    const reg = registry();
    const firms = reg.get('firms')!;
    reg.set('firms', {
      ...firms,
      fetch: async () => {
        throw new Error('unexpected adapter crash');
      },
    });
    reg.set('nifc', downStub(reg.get('nifc')!)); // perimeter source down too ⇒ seeded perimeter retained
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const live = caIncident(seed).derivation;
    expect(live.hazards).toEqual(caIncident(DEFAULT_SEED).derivation.hazards); // retained
    expect(caIncident(seed).provenance.length).toBeGreaterThan(0); // still labelled, never empty
  });

  it('CONSUMES nifc: FIRMS hotspots + NIFC perimeters MERGE (both kinds present); nifc in provenance', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const live = caIncident(seed).derivation;
    // The COP now carries BOTH a fire PERIMETER (nifc) and fire HOTSPOTS (firms) — closes FIRMS ≠ perimeters.
    expect(live.hazards.some((h) => h.kind === 'PERIMETER')).toBe(true);
    expect(live.hazards.some((h) => h.kind === 'HOTSPOT')).toBe(true);
    expect(provIds(caIncident(seed).provenance)).toContain('nifc');
  });

  it('nifc DOWN ⇒ the seeded PERIMETER (sourceId nifc) is RETAINED alongside served FIRMS hotspots (Art. XVI)', async () => {
    const reg = registry();
    reg.set('nifc', downStub(reg.get('nifc')!)); // perimeter source down; firms still serves hotspots
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const perims = caIncident(seed).derivation.hazards.filter((h) => h.kind === 'PERIMETER');
    const seededPerim = caIncident(DEFAULT_SEED).derivation.hazards.find(
      (h) => h.kind === 'PERIMETER',
    )!;
    expect(seededPerim.sourceId).toBe('nifc'); // seed honesty: perimeter is NIFC-sourced, never FIRMS
    expect(perims).toContainEqual(seededPerim); // retained byte-for-byte when nifc is down
  });

  it('RO CONSUMES effis: EFFIS EU/global fire MERGES with the seeded FLOOD_REACH; effis in provenance', async () => {
    const overrides = { ...ALL_MOCK, glofas: 'CACHED', effis: 'CACHED', 'meteoalarm-ro': 'CACHED' };
    const seed = await assembleLiveCoreSeed(registry(overrides), regions(), DEFAULT_SEED, clock);
    const ro = roIncident(seed);
    // seeded FLOOD_REACH is retained AND effis fire geometries are added (both kept, honestly labelled).
    expect(ro.derivation.hazards.some((h) => h.kind === 'FLOOD_REACH')).toBe(true);
    expect(ro.derivation.hazards.length).toBeGreaterThan(
      roIncident(DEFAULT_SEED).derivation.hazards.length,
    );
    expect(provIds(ro.provenance)).toContain('effis');
    expect(provIds(ro.provenance)).not.toContain('nifc'); // nifc is US-only ⇒ NOT_COVERED for RO
  });

  it('RO path: global sources enrich; US-only sources (nwps/census/eagle-i/nws) NOT_COVERED are skipped + not leaked', async () => {
    const overrides = { ...ALL_MOCK, glofas: 'CACHED', 'meteoalarm-ro': 'CACHED' };
    const seed = await assembleLiveCoreSeed(registry(overrides), regions(), DEFAULT_SEED, clock);
    const ro = roIncident(seed);
    expect(ro.derivation.hazards.length).toBeGreaterThan(0); // RO hazards stay seeded
    const ids = provIds(ro.provenance);
    expect(ids.length).toBeGreaterThan(0);
    // US-only adapters never leak into RO provenance.
    for (const usOnly of ['nwps', 'usgs-water', 'nws', 'census', 'eagle-i'])
      expect(ids).not.toContain(usOnly);
    // GLOBAL sources (worldpop, osm-overpass, gdelt, gdacs) + RO-only meteoalarm-ro do contribute.
    for (const global of ['glofas', 'worldpop', 'osm-overpass', 'gdelt', 'gdacs', 'meteoalarm-ro'])
      expect(ids).toContain(global);
  });

  // ── S3: the AirQuality slot (P17 trio consumer — the fact input derive-cop's airQualityFact reads) ───
  it('CA CONSUMES airnow + openaq: both cited; the first source that serves DATA supplies derivation.airQuality', async () => {
    const reg = registry();
    // The OpenAQ fixture was recorded in Washington state; a recording from elsewhere is not served for
    // California, so the reading is moved into Butte County for a test that is about what a served
    // reading does, not about where the fixture was captured.
    reg.set('openaq', await relocatedStub(reg.get('openaq')!, [-121.6, 39.7]));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const ca = caIncident(seed);
    // Both consulted + cited, in precedence order (airnow first — the official US index outranks the aggregator).
    const ids = provIds(ca.provenance);
    expect(ids).toContain('airnow');
    expect(ids).toContain('openaq');
    expect(ids.indexOf('airnow')).toBeLessThan(ids.indexOf('openaq'));
    // The airnow FIXTURE's stations are all WA/OR — its parse-time bbox narrowing yields ZERO CA readings
    // (served-but-empty: cited, never invented), so openaq is the first source serving DATA and the fact
    // input is attributed to IT (the F-64 rule: the citation follows the data, never the precedence label).
    const aq = ca.derivation.airQuality;
    expect(aq).toBeDefined();
    expect(String(aq!.grounding.sourceId)).toBe('openaq');
    expect(String(aq!.grounding.citationId)).toBe('cit-air-quality-openaq');
    expect(aq!.grounding.field).toBe('airQuality');
    expect(aq!.readings.length).toBeGreaterThan(0);
    for (const r of aq!.readings) {
      expect(typeof r.value).toBe('number'); // figures are the reading's own (Art. XII)
      expect(typeof r.unit).toBe('string'); // unit carried VERBATIM, never converted
    }
  });

  it('RO CONSUMES sensorcommunity (dense EU citizen PM network) as the winning airQuality source', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const ro = roIncident(seed);
    const aq = ro.derivation.airQuality;
    expect(aq).toBeDefined();
    expect(String(aq!.grounding.sourceId)).toBe('sensorcommunity'); // listed before openaq in RO's precedence
    expect(aq!.readings.length).toBeGreaterThan(0);
    expect(provIds(ro.provenance)).toEqual(expect.arrayContaining(['sensorcommunity', 'openaq']));
    // airnow is NORTH-AMERICA-only (BBOX coverage) and not enabled for RO — never consulted, never cited.
    expect(provIds(ro.provenance)).not.toContain('airnow');
  });

  it('every AQ source down ⇒ derivation.airQuality stays ABSENT — nothing seeded, nothing invented (Art. XVI)', async () => {
    const reg = registry();
    reg.set('airnow', downStub(reg.get('airnow')!));
    reg.set('openaq', downStub(reg.get('openaq')!));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const ca = caIncident(seed);
    // Unlike weather/crest there is NO seeded air-quality fact to retain: the honest degrade is no fact
    // input at all (the SitRep simply carries no airQuality row), never a fabricated reading.
    expect(ca.derivation.airQuality).toBeUndefined();
    expect(ca.derivation.hazards.length).toBeGreaterThan(0); // the rest of the assembly is untouched
  });

  // ── S3 sweep fix: a SERVED population figure now carries its own grounding (F-66(b) re-closed) ───────
  it('a served population source sets populationGrounding to the SAME adapter choosePopulation used', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    // CA lists census before worldpop; RO has only worldpop of the two. In both cases the grounding must
    // name the FIRST-SERVING adapter — the one whose count the derivation actually carries — so the
    // populationFact the SitRep renders cites the source of its own figure, never the hazard source and
    // never the precedence label (the F-64 rule).
    const ca = caIncident(seed);
    expect(ca.derivation.populationGrounding).toBeDefined();
    expect(String(ca.derivation.populationGrounding!.sourceId)).toBe('census');
    expect(String(ca.derivation.populationGrounding!.citationId)).toBe('cit-population-census');
    expect(ca.derivation.populationGrounding!.field).toBe('population');
    const ro = roIncident(seed);
    expect(String(ro.derivation.populationGrounding!.sourceId)).toBe('worldpop');
  });

  it('every population source down ⇒ the SEEDED figure stays UNGROUNDED — no invented citation', async () => {
    const reg = registry();
    for (const id of ['census', 'worldpop', 'nri', 'hdxpop'])
      if (reg.has(id)) reg.set(id, downStub(reg.get(id)!));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const ca = caIncident(seed);
    // The seeded planning number survives (Art. XVI), but it is NOT a source observation: grounding stays
    // absent, so populationFact never fires for it. Minting a citation for a seed value would be F-64 in
    // reverse — a right citation shape on a figure no source produced.
    expect(ca.derivation.populationGrounding).toBeUndefined();
    expect(ca.derivation.exposedPopulation).toBeGreaterThan(0);
  });
});

describe('assembleLiveMapSeed', () => {
  it('populates the Phase-D raw slices (outages/cellSites/floodZones/weatherObservation) + layerSources when served', async () => {
    const reg = registry();
    // The open-meteo fixture was recorded over Bucharest — moved into California for the same reason as
    // the OpenAQ reading above.
    reg.set('open-meteo', await relocatedStub(reg.get('open-meteo')!, [-121.6, 39.7]));
    // …and the NFHL fixture over New Orleans, for the same reason.
    reg.set('nfhl', await relocatedStub(reg.get('nfhl')!, [-121.6, 39.7]));
    const map = await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions());
    const ca = map['us-ca']!;
    expect(ca.hazards.length).toBeGreaterThan(0);
    expect(ca.infrastructure).not.toBe(DEFAULT_MAP_SEED['us-ca']!.infrastructure); // osm-overpass replaced it
    expect(ca.outages?.length).toBeGreaterThan(0); // eagle-i OutageRecord[]
    expect(ca.cellSites?.length).toBeGreaterThan(0); // opencellid TelecomCoverage[]
    expect(ca.floodZones?.length).toBeGreaterThan(0); // nfhl FloodZone[]
    expect(ca.weatherObservation).toBeDefined(); // open-meteo observation (the wind glyph W2b projects)
    // per-layer source attribution stamped for the served layers (W3a per-layer freshness).
    expect(ca.layerSources).toMatchObject({
      fire: 'firms',
      infra: 'osm-overpass',
      outage: 'eagle-i',
      cell: 'opencellid',
    });
    expect(ca.provenance.every((p) => ['LIVE', 'CACHED', 'MOCK'].includes(p.mode))).toBe(true);
  });

  it('eagle-i outage ∩ infra → outageNodeIds marks the matching nodes ASSUMED offline (not cells outside the area)', async () => {
    const reg = registry();
    // Keep the seeded CA nodes (known coords) by taking osm-overpass down, and serve a controlled outage AOI.
    reg.set('osm-overpass', downStub(reg.get('osm-overpass')!));
    const outage: OutageRecord = {
      area: [-121.65, 39.65, -121.55, 39.75],
      customersOut: 5000,
      observedAt: NOW,
    };
    reg.set('eagle-i', servedStub(reg.get('eagle-i')!, [outage]));
    const ca = (await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions()))['us-ca']!;
    const ids = (ca.outageNodeIds ?? []).map(String);
    expect(ids).toContain('ca-substation-north'); // [-121.61,39.72] inside the AOI
    expect(ids).toContain('ca-substation-south'); // [-121.58,39.68] inside the AOI
    expect(ids).not.toContain('ca-cell-south'); // [-121.49,39.61] outside → not assumed offline
  });

  it('source-down RETAINS the seeded Phase-D slices (never a dead-end, Art. XVI)', async () => {
    const reg = registry();
    for (const id of ['eagle-i', 'opencellid', 'nfhl', 'osm-overpass'])
      reg.set(id, downStub(reg.get(id)!));
    const ca = (await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions()))['us-ca']!;
    const seeded = DEFAULT_MAP_SEED['us-ca']!;
    expect(ca.outages).toBe(seeded.outages); // seeded CA_OUTAGES retained
    expect(ca.cellSites).toBe(seeded.cellSites); // seeded CA_CELL_SITES retained
    expect(ca.infrastructure).toBe(seeded.infrastructure); // seeded CA_MAP_NODES retained
    expect(ca.layerSources).toMatchObject({ fire: 'firms', outage: 'eagle-i', cell: 'opencellid' }); // seeded base stamps kept
  });

  it('CA map CONSUMES nifc: fire PERIMETER + FIRMS hotspots merge into map hazards; nifc in map provenance', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    expect(ca.hazards.some((h) => h.kind === 'PERIMETER')).toBe(true);
    expect(ca.hazards.some((h) => h.kind === 'HOTSPOT')).toBe(true);
    expect(provIds(ca.provenance)).toContain('nifc');
    // Layer badge stays 'firms' (freshest hotspot feed); NIFC attribution lives on the PERIMETER geometry.
    expect(ca.layerSources).toMatchObject({ fire: 'firms' });
  });

  it('CA map nifc DOWN ⇒ seeded PERIMETER retained (never dropped when the perimeter source is down)', async () => {
    const reg = registry();
    reg.set('nifc', downStub(reg.get('nifc')!));
    const ca = (await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions()))['us-ca']!;
    const seededPerim = DEFAULT_MAP_SEED['us-ca']!.hazards.find((h) => h.kind === 'PERIMETER')!;
    expect(seededPerim.sourceId).toBe('nifc');
    expect(ca.hazards).toContainEqual(seededPerim);
  });

  it('RO map CONSUMES effis (GLOBAL EU fire) into provenance', async () => {
    const ro = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))['ro']!;
    expect(provIds(ro.provenance)).toContain('effis');
  });

  it('the airQuality slot is INCIDENT-only: the map cites no AQ source (it paints no layer for one)', async () => {
    const map = await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions());
    // SLOT_PATHS.airQuality.map === false: citing an AQ source in the MAP's source list would claim
    // provenance for a layer it does not back — the same rule that keeps news/population off the map path.
    for (const regionId of ['us-ca', 'ro'] as const) {
      for (const id of ['openaq', 'airnow', 'sensorcommunity']) {
        expect(
          provIds(map[regionId]!.provenance),
          `${regionId} map must not cite '${id}'`,
        ).not.toContain(id);
      }
    }
  });

  it('RO map: nfhl (US-only) NOT_COVERED retains the seeded flood zones; opencellid’s Butte-County recording is NOT Romania’s cells', async () => {
    const map = await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions());
    const ro = map['ro']!;
    expect(ro.floodZones).toBe(DEFAULT_MAP_SEED['ro']!.floodZones); // nfhl NOT_COVERED for RO → seeded retained
    // Until 2026-09-13 this line asserted the opposite ("opencellid is GLOBAL → serves cells"), and the
    // live map showed California's cell sites in Romania. GLOBAL says the source could know about
    // Romania; the recorded fixture is about Butte County, so it is not served here and the seeded RO
    // sites stay.
    expect(ro.cellSites).toBe(DEFAULT_MAP_SEED['ro']!.cellSites);
    expect(provIds(ro.provenance)).toContain('opencellid'); // consulted and labelled — it just served nothing HERE
    expect(ro.layerSources?.cell).toBe(DEFAULT_MAP_SEED['ro']!.layerSources?.cell); // badge unchanged: nothing served
    expect(provIds(ro.provenance)).not.toContain('nwps'); // US-only, not leaked
  });

  // ── E11 Live Views — camera layer (multi-source concat; seed-retained; per-region priority) ────────────
  it('CA map: served cameras MERGE (multi-source concat) + REPLACE the seed; caltrans-cctv + alertwildfire in provenance', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    expect(ca.cameras).not.toBe(DEFAULT_MAP_SEED['us-ca']!.cameras); // served sets replaced the seeded pins
    expect((ca.cameras ?? []).length).toBeGreaterThan(0);
    // multi-source layer: BOTH the Caltrans CCTV directory and the ALERTWildfire directory contribute pins.
    expect(provIds(ca.provenance)).toEqual(
      expect.arrayContaining(['caltrans-cctv', 'alertwildfire']),
    );
    for (const cam of ca.cameras ?? []) expect(cam.viewUrl.startsWith('https://')).toBe(true); // link-out https-only
    // deduped by id — no camera plotted twice.
    const ids = (ca.cameras ?? []).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('CA map: layerSources.cameras cites the FIRST served source in priority order (caltrans-cctv)', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    expect(ca.layerSources).toMatchObject({ cameras: 'caltrans-cctv' }); // primary badge; per-pin provider on each pin
  });

  it('all camera sources DOWN ⇒ the seeded CA pins are RETAINED (Art. XVI, never a dead-end)', async () => {
    const reg = registry();
    for (const id of ['caltrans-cctv', 'alertwildfire', 'dot511', 'windy-webcams'])
      reg.set(id, downStub(reg.get(id)!));
    const ca = (await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions()))['us-ca']!;
    expect(ca.cameras).toBe(DEFAULT_MAP_SEED['us-ca']!.cameras); // seeded CA_CAMERAS retained byte-for-byte
    expect(ca.layerSources).toMatchObject({ cameras: 'caltrans-cctv' }); // seeded base stamp kept
  });

  it('RO map: cameras come from cnadnr-ro (+ windy) ONLY; US camera sources are NOT fetched/leaked', async () => {
    const ro = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))['ro']!;
    expect((ro.cameras ?? []).length).toBeGreaterThan(0);
    expect(provIds(ro.provenance)).toContain('cnadnr-ro');
    expect(ro.layerSources).toMatchObject({ cameras: 'cnadnr-ro' });
    for (const usOnly of ['caltrans-cctv', 'alertwildfire', 'dot511'])
      expect(provIds(ro.provenance)).not.toContain(usOnly);
  });

  // ── WP A4 — the FEMA shelter DIRECTORY (P18 ShelterDirectory → the `shelters` slot) ────────────────────
  // The A4 handoff's last step. The adapter, its manifest row and its factory already existed; no region
  // enabled it and no slot consumed it, so nothing FEMA publishes could reach a reader. These pin the four
  // things that make the owner's "poll FEMA live instead of seeding" decision TRUE rather than merely
  // configured: the directory reaches the map layer; it reaches it VERBATIM (a CLOSED shelter stays CLOSED,
  // an uncounted capacity stays uncounted); a downed feed never empties the layer; and a non-US region is
  // NOT_COVERED rather than shown an empty one.
  it('CA map CONSUMES shelters-fema: the published directory REPLACES the seeded shelter + badges the layer', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    expect(ca.shelters).not.toBe(DEFAULT_MAP_SEED['us-ca']!.shelters); // served replaced the seeded hall
    expect(provIds(ca.provenance)).toContain('shelters-fema');
    expect(ca.layerSources).toMatchObject({ shelters: 'shelters-fema' }); // W3a per-layer freshness badge
    // Every shelter on the layer is now one FEMA published: the hand-seeded `ca-shelter-1` (an invented
    // 200-bed hall) is gone, which is the entire point of polling a directory instead of freezing a seed.
    expect(ca.shelters.length).toBeGreaterThan(1);
    for (const s of ca.shelters) expect(String(s.id).startsWith('shelters-fema:')).toBe(true);
  });

  it('a CLOSED shelter reaches the map as CLOSED — never promoted, never filtered out to look busier', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    const statuses = ca.shelters.map((s) => s.status);
    // California's real picture: a register of CLOSED buildings with a single OPEN destination on it. Both
    // must survive the bridge — dropping the closed ones would fabricate a busier map, and there is no code
    // path here that may upgrade one (the ACL carries `shelter_status_code` through unchanged).
    expect(statuses.filter((s) => s === 'CLOSED').length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 'OPEN').length).toBeGreaterThan(0);
    for (const s of statuses) expect(['OPEN', 'FULL', 'CLOSED']).toContain(s);
  });

  it('an UNCOUNTED capacity reaches the map as 0 — INELIGIBLE for matching, never an invented headroom', async () => {
    const ca = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))[
      'us-ca'
    ]!;
    const open = ca.shelters.filter((s) => s.status === 'OPEN');
    expect(open.length).toBe(1); // the one open California shelter in the recorded national open layer
    // It publishes the 99999 placeholder ⇒ "nobody has counted this building" ⇒ capacity 0. A 0 here is a
    // REFUSAL to guess, and the bridge must not quietly turn it into spare beds on the way to the map.
    expect(open[0]!.capacity).toBe(0);
    expect(open[0]!.occupancy).toBe(0);
  });

  it('shelters-fema DOWN ⇒ the seeded CA shelter is RETAINED (Art. XVI — never an empty shelter layer)', async () => {
    const reg = registry();
    reg.set('shelters-fema', downStub(reg.get('shelters-fema')!));
    const ca = (await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions()))['us-ca']!;
    expect(ca.shelters).toBe(DEFAULT_MAP_SEED['us-ca']!.shelters); // seeded slice kept byte-for-byte
  });

  it('the shelters slot is MAP-only: the SitRep path cites no shelter directory (SLOT_PATHS.shelters.incident)', async () => {
    const core = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    // A shelter directory paints a map layer; it changes no SitRep FACT (the only SitRep figure shelters
    // could feed is the shelter-demand quantification, whose supply term sums capacity over EVERY shelter
    // handed to it — closed buildings included — so feeding a directory that is 96 % CLOSED would publish
    // spare capacity that does not exist). Citing it on GET /status would claim provenance for a fact the
    // SitRep does not state, exactly as airQuality is kept off the map path.
    expect(provIds(caIncident(core).provenance)).not.toContain('shelters-fema');
  });

  it('RO map: shelters-fema (US-only) is never consulted and the seeded RO shelter is retained', async () => {
    const ro = (await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()))['ro']!;
    expect(provIds(ro.provenance)).not.toContain('shelters-fema');
    expect(ro.shelters).toBe(DEFAULT_MAP_SEED['ro']!.shelters);
  });

  it('the seeded camera pins are valid link-out CameraFeeds (https viewUrl, non-empty provider/license)', () => {
    const cams = [
      ...(DEFAULT_MAP_SEED['us-ca']!.cameras ?? []),
      ...(DEFAULT_MAP_SEED['ro']!.cameras ?? []),
    ];
    expect(cams.length).toBe(5); // 3 CA (1 fire + 2 CCTV) + 2 RO
    for (const cam of cams) {
      expect(new URL(cam.viewUrl).protocol).toBe('https:'); // href-injection guard (Art. XII)
      expect(cam.provider.length).toBeGreaterThan(0);
      expect(cam.license.length).toBeGreaterThan(0);
    }
  });
});

// ── B1.8 CHARACTERISATION SNAPSHOTS ─────────────────────────────────────────────────────────────────
// A frozen record of the enrichment behaviour for BOTH shipped regions across BOTH assemblies (SitRep
// incident/core + COP map), captured against the FOUR BESPOKE enrich* functions before the generic
// coverage-driven path replaced them. Deterministic: every adapter MOCK (recorded fixtures), fixed clock,
// fixed id generator, no network. The refactor had to reproduce these; each snapshot that legitimately
// changed is listed with its justification in the B1.8 report (all of them are provenance CITATION lists —
// no entity, geometry, count, layer badge or freshness value moved).
//
// One aspect per test on purpose: a failing snapshot assertion aborts its test, so bundling aspects would
// let the first diff MASK every later one — the opposite of what a characterisation net is for. The
// assemblies are memoized so the extra tests cost one assembly each, not one per assertion.
describe('B1.8 characterisation snapshots (frozen enrichment behaviour, us-ca + ro)', () => {
  /** Compact, ORDER-PRESERVING view of a provenance list: id:mode:fetchedAt per ref, in array order. */
  const provView = (
    refs: readonly { sourceId: string; mode: string; fetchedAt: string }[],
  ): readonly string[] => refs.map((r) => `${r.sourceId}:${r.mode}:${r.fetchedAt}`);

  /**
   * Entity snapshots are taken through a COUNTER-INDEPENDENT view of the per-fetch SourceRecord id.
   * `fixed.idGen` mints `sr-1, sr-2, …` across the whole file, so the ABSOLUTE number a fetch receives
   * depends on how many fetches preceded it — a value that shifts whenever the consulted set changes and
   * that carries no behaviour (in production it is a uuid). What IS behaviour is the record-SHARING
   * structure: every entity from one fetch cites the same SourceRecord, and two fetches never share one.
   * So each distinct `sr-N` is rewritten to its order of first appearance (`sr#1`, `sr#2`, …) — pinning the
   * sharing structure exactly while ignoring the counter's offset. Everything else (geometry, kinds, ids,
   * timestamps, intensities, counts, and every array ORDER) is snapshotted verbatim.
   */
  function stableRecordIds(value: unknown): unknown {
    const seen = new Map<string, string>();
    return JSON.parse(JSON.stringify(value ?? null), (_key, raw: unknown) => {
      if (typeof raw !== 'string' || !/^sr-\d+$/.test(raw)) return raw;
      const mapped = seen.get(raw) ?? `sr#${seen.size + 1}`;
      seen.set(raw, mapped);
      return mapped;
    });
  }

  /** A map input's DATA slices only — provenance/layerSources/freshness get their own snapshots above. */
  function sliceView(input: object): unknown {
    const slices: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    for (const aspect of ['provenance', 'layerSources', 'freshness']) delete slices[aspect];
    return stableRecordIds(slices);
  }

  /** Assemble each scenario ONCE (the id counter makes assemblies order-dependent; see stableRecordIds). */
  const assemblies = new Map<string, Promise<unknown>>();
  function scenario<T>(key: string, make: () => Promise<T>): Promise<T> {
    const hit = assemblies.get(key);
    if (hit !== undefined) return hit as Promise<T>;
    const built = make();
    assemblies.set(key, built);
    return built;
  }

  const coreSeed = () =>
    scenario('core', () => assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock));
  const mapSeed = () =>
    scenario('map', () => assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, regions()));

  /** Open-Meteo (CA's primary weather source) down — the seam where a weather FALLBACK rung is observable. */
  const weatherDown = () =>
    scenario('weather-down', () => {
      const reg = registry();
      reg.set('open-meteo', downStub(reg.get('open-meteo')!));
      return assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    });

  /** NWPS (CA's primary gauge) down — the seam where a gauge FALLBACK rung is observable. */
  const gaugeDown = () =>
    scenario('gauge-down', () => {
      const reg = registry();
      reg.set('nwps', downStub(reg.get('nwps')!));
      return assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions());
    });

  /** GloFAS — RO's ONLY FloodGauge rung — down. The seam where the crest fact must degrade honestly. */
  const crestGaugeDown = () =>
    scenario('crest-gauge-down', () => {
      const reg = registry();
      reg.set('glofas', downStub(reg.get('glofas')!));
      return assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    });

  describe('core seed (SitRep inputs)', () => {
    it('us-ca provenance', async () => {
      expect(provView(caIncident(await coreSeed()).provenance)).toMatchSnapshot(
        'ca-incident-provenance',
      );
    });

    it('us-ca sources projection (GET /status)', async () => {
      expect(provView([...((await coreSeed()).sources['us-ca'] ?? [])])).toMatchSnapshot(
        'ca-sources-projection',
      );
    });

    it('us-ca freshness', async () => {
      expect(caIncident(await coreSeed()).freshness).toMatchSnapshot('ca-incident-freshness');
    });

    it('us-ca derivation inputs', async () => {
      expect(stableRecordIds(caIncident(await coreSeed()).derivation)).toMatchSnapshot(
        'ca-incident-derivation',
      );
    });

    it('us-ca news batch', async () => {
      expect(stableRecordIds(caIncident(await coreSeed()).news)).toMatchSnapshot(
        'ca-incident-news',
      );
    });

    it('ro provenance', async () => {
      expect(provView(roIncident(await coreSeed()).provenance)).toMatchSnapshot(
        'ro-incident-provenance',
      );
    });

    it('ro sources projection (GET /status)', async () => {
      expect(provView([...((await coreSeed()).sources['ro'] ?? [])])).toMatchSnapshot(
        'ro-sources-projection',
      );
    });

    it('ro freshness', async () => {
      expect(roIncident(await coreSeed()).freshness).toMatchSnapshot('ro-incident-freshness');
    });

    it('ro derivation inputs', async () => {
      expect(stableRecordIds(roIncident(await coreSeed()).derivation)).toMatchSnapshot(
        'ro-incident-derivation',
      );
    });

    it('ro news batch', async () => {
      expect(stableRecordIds(roIncident(await coreSeed()).news)).toMatchSnapshot(
        'ro-incident-news',
      );
    });
  });

  describe('map seed (COP map inputs)', () => {
    it('us-ca provenance', async () => {
      expect(provView((await mapSeed())['us-ca']!.provenance)).toMatchSnapshot('ca-map-provenance');
    });

    it('us-ca layerSources (per-layer freshness badges)', async () => {
      expect((await mapSeed())['us-ca']!.layerSources).toMatchSnapshot('ca-map-layerSources');
    });

    it('us-ca freshness', async () => {
      expect((await mapSeed())['us-ca']!.freshness).toMatchSnapshot('ca-map-freshness');
    });

    it('us-ca slices (hazards/gauges/infra/outages/cells/zones/cameras/weather)', async () => {
      expect(sliceView((await mapSeed())['us-ca']!)).toMatchSnapshot('ca-map-slices');
    });

    it('ro provenance', async () => {
      expect(provView((await mapSeed())['ro']!.provenance)).toMatchSnapshot('ro-map-provenance');
    });

    it('ro layerSources (per-layer freshness badges)', async () => {
      expect((await mapSeed())['ro']!.layerSources).toMatchSnapshot('ro-map-layerSources');
    });

    it('ro freshness', async () => {
      expect((await mapSeed())['ro']!.freshness).toMatchSnapshot('ro-map-freshness');
    });

    it('ro slices (hazards/gauges/infra/cells/zones/cameras/weather)', async () => {
      expect(sliceView((await mapSeed())['ro']!)).toMatchSnapshot('ro-map-slices');
    });
  });

  // Down-scenarios: the two seams where precedence-as-config can legitimately change behaviour, because a
  // LOWER-precedence source of the same port can now step in for a downed primary. Frozen so any such
  // change is explicit and reviewed rather than silent.
  describe('primary-down seams (fallback rungs)', () => {
    it('us-ca incident provenance with open-meteo down', async () => {
      expect(provView(caIncident(await weatherDown()).provenance)).toMatchSnapshot(
        'ca-incident-weather-down-provenance',
      );
    });

    it('us-ca weather fact with open-meteo down', async () => {
      expect(stableRecordIds(caIncident(await weatherDown()).derivation.weather)).toMatchSnapshot(
        'ca-incident-weather-down-fact',
      );
    });

    it('us-ca map provenance with nwps down', async () => {
      expect(provView((await gaugeDown())['us-ca']!.provenance)).toMatchSnapshot(
        'ca-map-gauge-down-provenance',
      );
    });

    it('us-ca map gauges with nwps down', async () => {
      expect(stableRecordIds((await gaugeDown())['us-ca']!.gauges)).toMatchSnapshot(
        'ca-map-gauge-down-gauges',
      );
    });

    it('us-ca map layerSources with nwps down', async () => {
      expect((await gaugeDown())['us-ca']!.layerSources).toMatchSnapshot(
        'ca-map-gauge-down-layerSources',
      );
    });

    // F-93 (crest wiring) + F-64 (re-attribution). `updateCrest` mirrors `updateWeather`: a SERVED gauge
    // replaces the seeded crest AND re-stamps `grounding.sourceId` with the adapter that actually served
    // it. F-64 exists because the weather path once carried NWS's number under Open-Meteo's citation — a
    // wrong citation on a right number is a provenance failure, not a cosmetic one.
    // NOTE ON COVERAGE, stated honestly: `ro` enables exactly ONE FloodGauge rung (`glofas`; `nwps` is
    // US-only ⇒ NOT_COVERED), so there is no second serving adapter to switch TO in this fixture — the
    // multi-rung re-attribution proof lives on the weather seam above, which shares the mechanism. What is
    // provable here is the pair that matters for honesty: served ⇒ stamped with the server; unserved ⇒ the
    // seeded value AND its own citation are retained, never a source that served nothing (Art. XVI).
    it('ro crest fact is stamped with the adapter that actually served the gauge (F-64)', async () => {
      const crest = roIncident(await coreSeed()).derivation.crest;
      expect(crest?.grounding.sourceId).toBe('glofas');
      // The served reading — not the seeded placeholder — is what the SitRep will state.
      // These values changed with A11 (ADR: GloFAS strict-WMS): the previous fixture was an INVENTED
      // GeoJSON shape, and the adapter now replays a RECORDED real GetFeatureInfo response for the Siret
      // at Lungoci. The river was genuinely quiet when it was recorded, so the honest reading is "no
      // alert" — a duller demo than the fabricated 74 % / MODERATE, and the only one that is true.
      expect(crest?.input.exceedanceProbability).toBe(0);
      expect(crest?.input.floodCategory).toBe('none');
    });

    it('ro crest fact retains its SEEDED value and citation when the only gauge rung is down (Art. XVI)', async () => {
      const down = roIncident(await crestGaugeDown()).derivation.crest;
      const seeded = roIncident(DEFAULT_SEED).derivation.crest;
      expect(down).toEqual(seeded);
      // The citation must still be the SEED's own — degrading may not stamp the fact with an adapter that
      // served nothing. (The seed legitimately carries its own offline reading, incl. a seeded
      // exceedanceProbability; it is the SEED's figure under the SEED's citation, which is the honest pair.
      // What would be dishonest is the served-path stamp appearing on a value nobody served.)
      expect(down?.grounding.sourceId).toBe(seeded?.grounding.sourceId);
      expect(down?.grounding.citationId).toBe(seeded?.grounding.citationId);
      // And it must NOT have silently acquired the served reading's distinct value.
      expect(down?.input.exceedanceProbability).not.toBe(0.74);
    });
  });
});

// ── B1.8 STRUCTURAL GUARANTEES ──────────────────────────────────────────────────────────────────────
// The refactor's claims, asserted structurally rather than by mirroring a hand-written id list. These are
// the tests that fail when someone adds a manifest row, a port, or a zone and forgets the consequence.
describe('B1.8 generic enrichment — structural guarantees', () => {
  const manifest = (): readonly { id: string; port: string }[] => {
    const res = loadManifest();
    if (!res.ok) throw new Error(`manifest failed: ${res.error.message}`);
    return res.value.adapters;
  };

  // Every port in the shipped manifest must be routed to a domain slot. SLOT_BY_PORT is exhaustive over the
  // PortName union (a compile error if a name is added without a slot), but a NEW PORT STRING in the JSON
  // cannot be a type error — so this is its enforcement point. Without it, a new port would silently route
  // nowhere and its adapter would never be consulted by any region: a dropped layer with no failure.
  const ROUTED_PORTS: readonly string[] = [
    'HazardSource',
    'Weather',
    'FloodGauge',
    'NewsIntel',
    'Infrastructure',
    'Population',
    'FloodZone',
    'Outage',
    'Telecom',
    'CameraDirectory',
    'AirQuality',
    'ShelterDirectory',
  ];

  it('every port declared in config/adapters.json is routed to a domain slot', () => {
    const unrouted = [...new Set(manifest().map((a) => a.port))].filter(
      (p) => !ROUTED_PORTS.includes(p),
    );
    expect(
      unrouted,
      `unrouted ports (add them to SLOT_BY_PORT in live-seed.ts): ${unrouted.join(', ')}`,
    ).toEqual([]);
  });

  // The footprint/event split inside the HazardSource port decides whether an adapter's geometry is DRAWN and
  // fed to exposure, or only cited. An unclassified new hazard row defaults to EVENT (cited, never drawn) —
  // the safe direction — but that default must be a DECISION, not an oversight, so it is pinned here.
  it('every HazardSource in the manifest is classified footprint-or-event', () => {
    const footprints = ['firms', 'nifc', 'effis']; // must mirror HAZARD_FOOTPRINT_SOURCES in live-seed.ts
    const events = ['gdacs', 'eonet', 'cemsrm']; // advisory/alert feeds: event centroids, never hazard extents (cf. F-48)
    const hazardIds = manifest()
      .filter((a) => a.port === 'HazardSource')
      .map((a) => a.id)
      .sort();
    expect(hazardIds).toEqual([...footprints, ...events].sort());
  });

  // WP A4 region scoping. `shelters-fema` covers COUNTRIES:['US'] only, so enabling it anywhere else would
  // make that region consult an adapter that can only answer NOT_COVERED — which the both-directions test
  // below would then fail on, since a NOT_COVERED row is legitimately absent from provenance. Pinned here so
  // the failure names the real cause (a US-only source on a non-US region) instead of a generic mismatch.
  it('shelters-fema (US-only coverage) is enabled on us-ca and on NO other region', () => {
    const enabling = regions().regions.filter((r) =>
      r.region.enabledAdapters.includes('shelters-fema'),
    );
    expect(enabling.map((r) => r.configId)).toEqual(['us-ca']);
  });

  // F-52's STRUCTURAL closure. The old guard mirrored the consulted ids by hand in adapter-registry.test.ts
  // because live-seed.ts's per-region lists were private constants; now the consulted set IS the allowlist,
  // so the invariant can be stated directly, in BOTH directions, for every shipped region:
  //   ⊆  nothing is consulted that the region does not enable (no source can reach a region by accident);
  //   ⊇  nothing is enabled that no assembly consults (no dead config silently promising a layer).
  // The second direction is the one that was false before B1.8: `usgs-water` was enabled on us-ca and
  // consulted by nothing, and `open-meteo`/the camera directories were consulted while missing from the
  // allowlist entirely (finding F-52), which is exactly how enforcing the allowlist would have deleted a
  // working layer.
  it('for every shipped region, the CONSULTED set equals its enabled_adapters (both directions)', async () => {
    const reg = regions();
    const core = await assembleLiveCoreSeed(registry(), reg, DEFAULT_SEED, clock);
    const map = await assembleLiveMapSeed(registry(), DEFAULT_MAP_SEED, clock, reg);
    for (const loaded of reg.regions) {
      const id = loaded.configId;
      const incident = core.incidents.find((i) => i.regionId === id);
      const consulted = new Set([
        ...provIds(incident?.provenance ?? []),
        ...provIds(map[id]?.provenance ?? []),
      ]);
      const enabled = new Set(loaded.region.enabledAdapters);
      for (const cited of consulted) {
        expect(enabled.has(cited), `region '${id}' cites '${cited}' which it does not enable`).toBe(
          true,
        );
      }
      // Every enabled adapter is consulted by at least one assembly. All shipped regions enable only
      // adapters that COVER them (US-only rows are absent from `ro`), so equality must hold exactly; a
      // NOT_COVERED row would legitimately be absent from provenance and would need this relaxed.
      for (const permitted of enabled) {
        expect(
          consulted.has(permitted),
          `region '${id}' enables '${permitted}' but no assembly consults it`,
        ).toBe(true);
      }
    }
  });

  // The FR-ZONE-3 claim, executed: a region that exists ONLY as config — no code mentions its id anywhere —
  // is enriched by the same generic path, from the global adapters it enables, in ITS OWN geography.
  it('a zone that exists only in config is enriched with ZERO code change (FR-ZONE-3)', async () => {
    const shipped = regions();
    const pt = {
      configId: 'pt',
      region: {
        ...shipped.regions[0]!.region,
        id: asId<RegionId>('pt'),
        iso: 'PT',
        bbox: [-9.55, 36.95, -6.19, 42.16] as const,
        // Global-coverage adapters only, in precedence order — no code knows this zone exists.
        enabledAdapters: ['effis', 'open-meteo', 'osm-overpass', 'worldpop', 'gdacs', 'gdelt'],
      },
      sourceModeOverrides: {},
    };
    const registryWithPt = {
      defaultRegionId: shipped.defaultRegionId,
      regions: [...shipped.regions, pt],
    };
    // Seed the new zone the way an unseeded region arrives: the CA incident's shape, but ITS region id.
    const seededPt = {
      ...caIncident(DEFAULT_SEED),
      regionId: asId<RegionId>('pt'),
      provenance: [],
    };
    const seed = { ...DEFAULT_SEED, incidents: [seededPt] };
    const out = await assembleLiveCoreSeed(registry(), registryWithPt as never, seed, clock);
    const enrichedPt = out.incidents[0]!;
    const cited = provIds(enrichedPt.provenance);
    // It got LIVE-path data from the global stack, mode-labelled, with no per-region code anywhere.
    expect(cited).toEqual(
      expect.arrayContaining(['effis', 'open-meteo', 'osm-overpass', 'worldpop', 'gdacs', 'gdelt']),
    );
    expect(enrichedPt.provenance.every((p) => ['LIVE', 'CACHED', 'MOCK'].includes(p.mode))).toBe(
      true,
    );
    // …and nothing it did not enable (e.g. the US-only or unlisted sources) reached it.
    for (const notEnabled of [
      'firms',
      'nifc',
      'nwps',
      'census',
      'eagle-i',
      'nfhl',
      'caltrans-cctv',
    ]) {
      expect(cited, `'pt' must not cite '${notEnabled}'`).not.toContain(notEnabled);
    }
    expect(enrichedPt.news?.length ?? 0).toBeGreaterThan(0); // gdelt served the news batch for the new zone
  });

  // Precedence is CONFIG, and the CA weather order is the load-bearing case: the manifest lists `nws` before
  // `open-meteo`, so a path that took precedence from the MANIFEST would silently switch California's weather
  // source. This pins that the region's array order — not the manifest's — decides, and that the fact is
  // attributed to whichever source actually supplied the reading.
  it('precedence comes from enabled_adapters order, not the manifest (CA weather: open-meteo over nws)', async () => {
    const manifestOrder = manifest()
      .filter((a) => a.port === 'Weather')
      .map((a) => a.id);
    // The trap this test exists to spring: the manifest lists nws BEFORE open-meteo, the OPPOSITE of the
    // precedence config declares. Stated as the ordering itself rather than as the full Weather inventory —
    // the inventory is pinned in adapter-registry.test.ts (all manifest ids), and duplicating it here made
    // every new weather source fail a test about PRECEDENCE for reasons that have nothing to do with it.
    expect(manifestOrder.indexOf('nws')).toBeLessThan(manifestOrder.indexOf('open-meteo'));
    const ca = regions().regions.find((r) => r.configId === 'us-ca')!.region.enabledAdapters;
    expect(ca.indexOf('open-meteo')).toBeLessThan(ca.indexOf('nws')); // config says Open-Meteo is primary
    // The open-meteo fixture was recorded over Bucharest; moved into California so the test is about
    // precedence, not about where the recording was made (a recording from elsewhere is not served).
    const primary = registry();
    primary.set('open-meteo', await relocatedStub(primary.get('open-meteo')!, [-121.6, 39.7]));
    const seed = await assembleLiveCoreSeed(primary, regions(), DEFAULT_SEED, clock);
    expect(caIncident(seed).derivation.weather?.grounding.sourceId).toBe('open-meteo');
    // …and with the primary down, the SECONDARY supplies the reading AND the citation (never a stale label).
    const reg = registry();
    reg.set('open-meteo', downStub(reg.get('open-meteo')!));
    const degraded = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    expect(caIncident(degraded).derivation.weather?.grounding.sourceId).toBe('nws');
  });
});

// ── Incident discovery (V3 §3.1) ──────────────────────────────────────────────────────────────────────
//
// The gap this closes was the biggest one on the board: twenty live sources, and the incident list still
// named only the seeded demo fire, because enrichment DECORATES an incident and nothing created one.
// These run against the same MOCK registry as everything above — the FIRMS fixture carries four hotspots,
// three of them close enough to be one fire.
describe('assembleLiveCoreSeed discovers incidents from live hazards', () => {
  const discovered = (seed: Awaited<ReturnType<typeof assembleLiveCoreSeed>>) =>
    seed.incidents.filter((i) => String(i.id).startsWith('discovered:'));

  it('adds an incident for a cluster of unclaimed hotspots, and keeps every seeded incident', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const found = discovered(seed);
    expect(found.length).toBeGreaterThan(0);
    // Additive, never a replacement: a region whose live sources are quiet must keep its seeded incident
    // rather than emptying the board.
    for (const base of DEFAULT_SEED.incidents) {
      expect(seed.incidents.some((i) => i.id === base.id)).toBe(true);
    }
  });

  it('files the discovered incident under the region whose hazards produced it', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    for (const inc of discovered(seed)) {
      expect(DEFAULT_SEED.incidents.some((b) => b.regionId === inc.regionId)).toBe(true);
    }
  });

  it('cites only the sources that found it, and inherits no planning-estimate population', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const inc = seed.incidents.find((i) => String(i.id).startsWith('discovered:'));
    expect(inc).toBeDefined();
    if (inc === undefined) return;
    // The region's weather and population feeds had nothing to do with finding this fire.
    const hazardSources = ['firms', 'nifc', 'gdacs', 'eonet', 'effis', 'cemsrm', 'lanceflood'];
    // Since 2026-09-14 the region's served weather may travel too — cited by its own source (PR-B).
    const weatherSources = ['open-meteo', 'nws', 'metno'];
    expect(
      provIds(inc.provenance).every(
        (id) => hazardSources.includes(id) || weatherSources.includes(id),
      ),
    ).toBe(true);
    expect(provIds(inc.provenance)).toContain('firms');
    // Inheriting the seeded figure would print the same "residents exposed" beside every discovered fire.
    expect(inc.derivation.exposedPopulation).toBe(0);
    // …and nothing that would let a population FACT cite Census/WorldPop for a fire they never looked at:
    // the seeded incident's polygon count, source label and grounding stay with the seeded incident.
    expect(inc.derivation.populationGrounding).toBeUndefined();
    expect(inc.derivation.populationSourceLabel).toBeUndefined();
    expect(inc.derivation.populationPolygonServed).toBeUndefined();
    expect(caIncident(seed).derivation.populationGrounding).toBeDefined(); // the seeded one keeps its own
    // Nor anything else observed for the SEEDED incident: no acreage trend, crest, weather, air-quality
    // input or outage-node selection — each would become a fact of this fire cited to nothing.
    expect(inc.derivation.trendReadings).toEqual([]);
    expect(inc.derivation.trendSourceId).toBeUndefined();
    // The region's served weather may travel — only with its source cited on this very incident.
    const weatherCited = provIds(inc.provenance).some((id) =>
      ['open-meteo', 'nws', 'metno', 'anm'].includes(id),
    );
    expect(inc.derivation.weather !== undefined).toBe(weatherCited);
    expect(inc.derivation.crest).toBeUndefined();
    expect(inc.derivation.airQuality).toBeUndefined();
    expect(inc.derivation.outageNodeIds).toBeUndefined();
    expect(inc.derivation.populationEstimates).toBeUndefined();
    // The exposure claim cites the source whose hazards FOUNDED this incident, and the id is region-scoped.
    expect(provIds(inc.provenance)).toContain(String(inc.derivation.grounding.exposure.sourceId));
    expect(String(inc.id)).toMatch(new RegExp(`^discovered:${inc.regionId}:`));
    // …and its hazards are its OWN cluster, not the region's whole hazard set.
    expect(inc.derivation.hazards.length).toBeGreaterThan(0);
    expect(inc.derivation.hazards.length).toBeLessThanOrEqual(
      caIncident(seed).derivation.hazards.length,
    );
  });

  it('gives the same fire the same id on a second composition, so the board does not churn', async () => {
    // Every reingest re-composes. An id that moved would make one fire arrive as a new incident every
    // five minutes — and take every alert and acknowledgement with it.
    const first = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const second = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    expect(discovered(second).map((i) => i.id)).toEqual(discovered(first).map((i) => i.id));
  });

  it('leaves the per-region source projection to the seeded incidents alone', async () => {
    // GET /status reads this. A discovered incident cites a subset of the region's sources, so letting it
    // write here would SHRINK the region's source list to whatever found the last fire.
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    const ids = (seed.sources['us-ca'] ?? []).map((s) => String(s.sourceId));
    expect(ids).toContain('worldpop');
    expect(ids).toContain('nws');
  });
});

// ── One question, asked once (2026-09-12) ─────────────────────────────────────────────────────────────
//
// The live composition measured 247 s, and part of that was the same source being fetched twice per
// region in one run: the SitRep pass and the map pass consult overlapping adapters — FIRMS, NIFC, the
// gauges, the weather — and neither knew the other had just asked.
describe('the per-run slice memo', () => {
  it('fetches each adapter ONCE per region across both assemblies, and produces the same seeds', async () => {
    const counting = registry();
    const calls = new Map<string, number>();
    for (const [id, adapter] of counting) {
      counting.set(id, {
        ...adapter,
        fetch: (region) => {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          return adapter.fetch(region);
        },
      });
    }
    const memo = new Map<string, Promise<never>>() as unknown as Parameters<
      typeof assembleLiveCoreSeed
    >[4];
    const core = await assembleLiveCoreSeed(counting, regions(), DEFAULT_SEED, clock, memo);
    const map = await assembleLiveMapSeed(counting, DEFAULT_MAP_SEED, clock, regions(), memo);

    // FIRMS feeds BOTH assemblies. Five regions, two passes: ten fetches without the memo, five with —
    // one per region, which is the number of distinct questions actually being asked.
    expect(calls.get('firms')).toBe(5);
    // And the output is unchanged — this is a cost fix, not a behaviour change.
    const plain = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    expect(core.incidents.map((i) => i.id)).toEqual(plain.incidents.map((i) => i.id));
    expect(Object.keys(map)).toEqual(Object.keys(DEFAULT_MAP_SEED));
  });

  it('never lets one region read another region’s answer', async () => {
    // The memo is keyed by region AND adapter. A key that ignored the region would hand Romania
    // California's hotspots, which is the single worst thing a cache in this position could do.
    const counting = registry();
    const regionsSeen = new Map<string, string[]>();
    for (const [id, adapter] of counting) {
      counting.set(id, {
        ...adapter,
        fetch: (region) => {
          regionsSeen.set(id, [...(regionsSeen.get(id) ?? []), region.id]);
          return adapter.fetch(region);
        },
      });
    }
    const memo = new Map<string, Promise<never>>() as unknown as Parameters<
      typeof assembleLiveCoreSeed
    >[4];
    await assembleLiveCoreSeed(counting, regions(), DEFAULT_SEED, clock, memo);
    for (const [, seen] of regionsSeen) {
      expect(new Set(seen).size).toBe(seen.length); // each region asked at most once per adapter
    }
  });
});

// ── A recording from elsewhere is not a fact about this region (2026-09-13) ──────────────────────────
//
// The owner's report: "the points on the map are wrong, they are in other countries". Measured against
// the live API: California's cell sites and infrastructure on every region's map, Greek burnt areas on
// Romania's, Romanian ones on Greece's, Atlanta cameras on California's. Every one of them came through a
// source whose coverage gate said "could know about this region" and whose answer was about somewhere
// else.
describe('a served record that is not about the region is not served for the region', () => {
  const hazardAt = (id: string, lon: number, lat: number) => ({
    id: asId(id),
    incidentId: asId('firms-unassigned'),
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] as const },
    observedAt: NOW,
  });

  it('keeps the hotspots inside Romania and drops the Californian ones a GLOBAL source returned', async () => {
    const reg = registry();
    reg.set(
      'firms',
      servedStub(reg.get('firms')!, [
        hazardAt('h-galati', 28.05, 45.43),
        hazardAt('h-butte-1', -121.87, 39.75),
        hazardAt('h-butte-2', -121.8, 39.7),
        hazardAt('h-brasov', 25.55, 45.6),
      ]),
    );
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const ro = roIncident(seed);
    const ids = ro.derivation.hazards.filter((h) => h.kind === 'HOTSPOT').map((h) => String(h.id));
    expect(ids).toContain('h-galati');
    expect(ids).toContain('h-brasov');
    expect(ids).not.toContain('h-butte-1');
    expect(ids).not.toContain('h-butte-2');
    expect(provIds(ro.provenance)).toContain('firms'); // it DID serve something about Romania
  });

  it('a source whose whole answer is elsewhere is cited as consulted but serves nothing: the seeded slice is kept', async () => {
    const reg = registry();
    reg.set(
      'firms',
      servedStub(reg.get('firms')!, [
        hazardAt('h-butte-1', -121.87, 39.75),
        hazardAt('h-butte-2', -121.8, 39.7),
      ]),
    );
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const ro = roIncident(seed);
    const base = DEFAULT_SEED.incidents.find((i) => i.regionId === 'ro')!;
    expect(ro.derivation.hazards.filter((h) => h.kind === 'HOTSPOT')).toEqual(
      base.derivation.hazards.filter((h) => h.kind === 'HOTSPOT'),
    );
    // Consulted, so cited with its mode label — the same treatment as a served-but-empty answer.
    expect(provIds(ro.provenance)).toContain('firms');
    // …while California, which the recording IS about, is served.
    const ca = caIncident(seed);
    expect(ca.derivation.hazards.map((h) => String(h.id))).toContain('h-butte-1');
    expect(provIds(ca.provenance)).toContain('firms');
  });

  it('cites the adapter that FOUNDED a discovered incident, not the first hazard source merely consulted', async () => {
    const reg = registry();
    // FIRMS answers, but everything it says is about Butte County — consulted, cited, served nothing here.
    reg.set(
      'firms',
      servedStub(reg.get('firms')!, [
        hazardAt('h-butte-1', -121.87, 39.75),
        hazardAt('h-butte-2', -121.8, 39.7),
      ]),
    );
    // EFFIS publishes one perimeter in Romania — a single official perimeter founds an incident.
    const perimeter = {
      id: asId('p-brasov'),
      incidentId: asId('effis-unassigned'),
      sourceId: asId<SourceId>('effis'),
      kind: 'PERIMETER' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [25.5, 45.6],
            [25.6, 45.6],
            [25.6, 45.7],
            [25.5, 45.6],
          ],
        ] as const,
      },
      observedAt: NOW,
    };
    reg.set('effis', servedStub(reg.get('effis')!, [perimeter]));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const found = seed.incidents.find(
      (i) =>
        i.regionId === 'ro' &&
        String(i.id).startsWith('discovered:') &&
        i.derivation.hazards.some((h) => String(h.id) === 'p-brasov'),
    );
    expect(found).toBeDefined();
    if (found === undefined) return;
    expect(String(found.derivation.grounding.exposure.sourceId)).toBe('effis');
    // Narrowed to the founder (firms, which served nothing here, is not cited); the region's weather
    // source may follow, cited for the weather fact it grounds.
    const cited = provIds(found.provenance);
    expect(cited[0]).toBe('effis');
    expect(cited.filter((id) => !['open-meteo', 'nws', 'metno', 'anm'].includes(id))).toEqual([
      'effis',
    ]);
  });

  it('when no hazard record maps to an adapter, the claim cites a hazard-slot adapter from provenance — never a record id', async () => {
    const reg = registry();
    // Records whose sourceId is a per-fetch SourceRecord id that nothing maps (the hand-seeded shape).
    const unmapped = (id: string, lon: number, lat: number) => ({
      ...hazardAt(id, lon, lat),
      sourceId: asId<SourceId>('sr-0000-unmapped'),
    });
    reg.set(
      'firms',
      servedStub(reg.get('firms')!, [
        unmapped('h-1', 28.0, 45.4),
        unmapped('h-2', 28.02, 45.41),
        unmapped('h-3', 28.01, 45.42),
      ]),
    );
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const found = seed.incidents.find(
      (i) =>
        i.regionId === 'ro' &&
        String(i.id).startsWith('discovered:') &&
        i.derivation.hazards.some((h) => String(h.id) === 'h-1'),
    );
    expect(found).toBeDefined();
    if (found === undefined) return;
    const cited = String(found.derivation.grounding.exposure.sourceId);
    expect(cited).not.toBe('sr-0000-unmapped');
    expect(provIds(found.provenance)).toContain(cited); // resolvable: the claim names an adapter it cites
  });

  it('an entity without a location is never judged — a weather reading with no position still serves', async () => {
    const reg = registry();
    const base = reg.get('open-meteo')!;
    const served = await base.fetch({ id: 'ro', bbox: [20.2, 43.6, 29.8, 48.3] });
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    const stripped = served.value.records.map((r) => {
      const rest: Record<string, unknown> = { ...(r.entity as Record<string, unknown>) };
      delete rest['position'];
      delete rest['bbox'];
      return rest;
    });
    reg.set('open-meteo', servedStub(base, stripped, 'MOCK'));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    expect(provIds(roIncident(seed).provenance)).toContain('open-meteo');
  });
});

// ── ADR-043: live-only at the assembly seam ───────────────────────────────────────────────────────────
describe('the live-only picture at the assembly seam', () => {
  const liveOnly = { livePicture: 'live-only' as const };
  const hotspotAt = (id: string, lon: number, lat: number) => ({
    id: asId(id),
    incidentId: asId('firms-unassigned'),
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] as const },
    observedAt: NOW,
  });

  it('assembleLiveCoreSeed returns ONLY discovered incidents: no seeded demo, never the blank base that drove the enrichment', async () => {
    const reg = registry();
    reg.set(
      'firms',
      servedStub(
        reg.get('firms')!,
        [
          hotspotAt('h-1', 28.0, 45.4),
          hotspotAt('h-2', 28.02, 45.41),
          hotspotAt('h-3', 28.01, 45.42),
        ],
        'LIVE',
      ),
    );
    const seed = await assembleLiveCoreSeed(
      reg,
      regions(),
      DEFAULT_SEED,
      clock,
      undefined,
      liveOnly,
    );
    const ids = seed.incidents.map((i) => String(i.id));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('discovered:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('region:'))).toBe(false);
    expect(ids).not.toContain('ro-flood-demo');
    // The per-region source projection is still produced from the blank base's enrichment.
    expect((seed.sources['ro'] ?? []).length).toBeGreaterThan(0);
  });

  it('a MOCK answer is cited but never drawn: with every source MOCK, nothing is discovered', async () => {
    const seed = await assembleLiveCoreSeed(
      registry(),
      regions(),
      DEFAULT_SEED,
      clock,
      undefined,
      liveOnly,
    );
    expect(seed.incidents).toEqual([]);
    expect(
      (seed.sources['us-ca'] ?? []).some((s) => s.sourceId === 'firms' && s.mode === 'MOCK'),
    ).toBe(true);
  });

  it('hybrid (the default) is unchanged: seeded incidents stay and MOCK slices still serve', async () => {
    const seed = await assembleLiveCoreSeed(registry(), regions(), DEFAULT_SEED, clock);
    expect(seed.incidents.map((i) => String(i.id))).toContain('us-ca-wildfire-demo');
  });

  it('assembleLiveMapSeed starts every region from a blank input plus the agency shelter registry; MOCK layers stay empty', async () => {
    const map = await assembleLiveMapSeed(
      registry(),
      DEFAULT_MAP_SEED,
      clock,
      regions(),
      undefined,
      liveOnly,
    );
    const ca = map['us-ca']!;
    expect(ca.hazards).toEqual([]);
    expect(ca.gauges).toEqual([]);
    expect(ca.infrastructure).toEqual([]);
    expect(ca.route).toBeUndefined();
    expect(ca.predictions).toEqual([]);
    expect(ca.shelters.length).toBeGreaterThan(0);
    expect(ca.shelters.map((s) => String(s.id))).not.toContain('ca-shelter-1');
    expect(map['ro']!.shelters.length).toBeGreaterThan(0);
    expect(map['es']!.shelters).toEqual([]);
    expect(ca.provenance.length).toBeGreaterThan(0); // consulted, MOCK-labelled — still cited
  });

  it('a LIVE-served layer is drawn under live-only', async () => {
    const reg = registry();
    reg.set('firms', servedStub(reg.get('firms')!, [hotspotAt('h-ca', -121.6, 39.7)], 'LIVE'));
    const map = await assembleLiveMapSeed(
      reg,
      DEFAULT_MAP_SEED,
      clock,
      regions(),
      undefined,
      liveOnly,
    );
    expect(map['us-ca']!.hazards.map((h) => String(h.id))).toContain('h-ca');
  });
});

// ── PR-B (2026-09-14): discovered incidents carry the region's CITED weather; live-only fire cones ──────
describe('a discovered incident and the region’s weather', () => {
  const hotspotAt = (id: string, lon: number, lat: number) => ({
    id: asId(id),
    incidentId: asId('firms-unassigned'),
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] as const },
    observedAt: NOW,
  });
  const cluster = [
    hotspotAt('w-1', 28.0, 45.4),
    hotspotAt('w-2', 28.02, 45.41),
    hotspotAt('w-3', 28.01, 45.42),
  ];

  it('carries the served weather AND cites its source; without a served weather it carries none', async () => {
    const reg = registry();
    reg.set('firms', servedStub(reg.get('firms')!, cluster, 'LIVE'));
    reg.set('open-meteo', await relocatedStub(reg.get('open-meteo')!, [28.0, 45.4], 'LIVE'));
    const seed = await assembleLiveCoreSeed(reg, regions(), DEFAULT_SEED, clock);
    const found = seed.incidents.find((i) => String(i.id).startsWith('discovered:ro:'));
    expect(found).toBeDefined();
    if (found === undefined) return;
    expect(found.derivation.weather).toBeDefined();
    expect(provIds(found.provenance)).toContain('open-meteo'); // the fact is cited on the incident itself
    // Weather down: no weather fact, no weather citation — never an uncited claim.
    const down = registry();
    down.set('firms', servedStub(down.get('firms')!, cluster, 'LIVE'));
    down.set('open-meteo', downStub(down.get('open-meteo')!));
    down.set('metno', downStub(down.get('metno')!));
    down.set('anm', downStub(down.get('anm')!)); // Romania's third weather rung
    const quiet = await assembleLiveCoreSeed(down, regions(), DEFAULT_SEED, clock);
    const again = quiet.incidents.find((i) => String(i.id).startsWith('discovered:ro:'));
    expect(again?.derivation.weather).toBeUndefined();
    expect(provIds(again?.provenance ?? [])).not.toContain('open-meteo');
  });

  it('live-only map: a fire cone per discovered wildfire cluster from the served wind; none without wind', async () => {
    const reg = registry();
    reg.set(
      'firms',
      servedStub(
        reg.get('firms')!,
        [
          hotspotAt('c-1', -121.6, 39.7),
          hotspotAt('c-2', -121.62, 39.71),
          hotspotAt('c-3', -121.61, 39.72),
        ],
        'LIVE',
      ),
    );
    reg.set('open-meteo', await relocatedStub(reg.get('open-meteo')!, [-121.6, 39.7], 'LIVE'));
    const map = await assembleLiveMapSeed(reg, DEFAULT_MAP_SEED, clock, regions(), undefined, {
      livePicture: 'live-only',
    });
    const ca = map['us-ca']!;
    expect(ca.predictions.length).toBe(1);
    const cone = ca.predictions[0]!;
    expect(cone.kind).toBe('FIRE_CONE');
    expect(String(cone.incidentId)).toMatch(/^discovered:us-ca:WILDFIRE:/);
    // Without a served weather observation there is no wind, and therefore no cone.
    const noWx = registry();
    noWx.set(
      'firms',
      servedStub(
        noWx.get('firms')!,
        [
          hotspotAt('c-1', -121.6, 39.7),
          hotspotAt('c-2', -121.62, 39.71),
          hotspotAt('c-3', -121.61, 39.72),
        ],
        'LIVE',
      ),
    );
    noWx.set('open-meteo', downStub(noWx.get('open-meteo')!));
    noWx.set('nws', downStub(noWx.get('nws')!));
    noWx.set('metno', downStub(noWx.get('metno')!));
    const dark = await assembleLiveMapSeed(noWx, DEFAULT_MAP_SEED, clock, regions(), undefined, {
      livePicture: 'live-only',
    });
    expect(dark['us-ca']!.predictions).toEqual([]);
  });
});

// ── ADR-045: the lifeline and telecom sources are asked about the incidents, not the whole region ─────
describe('focus areas (ADR-045)', () => {
  it('hazard sources are consulted for the region; every other source gets the focus boxes around what they served', async () => {
    const counting = registry();
    const focusSeen = new Map<string, (readonly (readonly number[])[] | undefined)[]>();
    for (const [id, adapter] of counting) {
      counting.set(id, {
        ...adapter,
        fetch: async (region) => {
          focusSeen.set(id, [...(focusSeen.get(id) ?? []), region.focus]);
          const res = await adapter.fetch(region);
          // The fixture registry answers MOCK everywhere; a MOCK hazard answer never places the focus, so
          // FIRMS is relabelled as a LIVE answer here (the hotspots are the recorded ones).
          return id === 'firms' && res.ok
            ? { ...res, value: { ...res.value, mode: 'LIVE' as const, degraded: false } }
            : res;
        },
      });
    }
    await assembleLiveMapSeed(counting, { 'us-ca': DEFAULT_MAP_SEED['us-ca']! }, clock, regions());
    // The hazard slot never carries a focus (it is what the focus is computed from).
    expect(focusSeen.get('firms')?.every((f) => f === undefined)).toBe(true);
    // The lifeline slot does, and every box lies inside California.
    const infra = focusSeen.get('osm-overpass') ?? [];
    expect(infra.length).toBeGreaterThan(0);
    const [rw, rs, re, rn] =
      DEFAULT_MAP_SEED['us-ca']!.regionId === 'us-ca'
        ? [-124.48, 32.53, -114.13, 42.01]
        : [0, 0, 0, 0];
    for (const f of infra) {
      expect(f).toBeDefined();
      expect(f!.length).toBeGreaterThan(0);
      for (const [w, s, e, n] of f!) {
        expect(w).toBeGreaterThanOrEqual(rw);
        expect(e).toBeLessThanOrEqual(re);
        expect(s).toBeGreaterThanOrEqual(rs);
        expect(n).toBeLessThanOrEqual(rn);
      }
    }
  });

  it('focusOf: one padded rectangle per cluster, clipped to the region; nothing without served hazards', () => {
    const region = { id: 'us-ca', bbox: [-124.48, 32.53, -114.13, 42.01] as const };
    const hot = (id: string, lon: number, lat: number) =>
      makeHazardGeometry({
        id: asId<HazardGeometryId>(id),
        incidentId: asId<IncidentId>('firms-unassigned'),
        sourceId: asId<SourceId>('sr-1'),
        kind: 'HOTSPOT',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        observedAt: '2026-09-14T10:00:00Z',
      });
    const boxes = focusOf(
      [hot('a', -121.6, 39.7), hot('b', -121.61, 39.71), hot('c', -121.59, 39.69)],
      region,
    );
    expect(boxes).toHaveLength(1);
    const [w, s, e, n] = boxes[0]!;
    expect(w).toBeCloseTo(-121.71, 6);
    expect(e).toBeCloseTo(-121.49, 6);
    expect(s).toBeCloseTo(39.59, 6);
    expect(n).toBeCloseTo(39.81, 6);
    // A cluster at the border is clipped to the region's bbox.
    const edge = focusOf(
      [hot('d', -124.47, 40.0), hot('e', -124.46, 40.01), hot('f', -124.45, 40.02)],
      region,
    );
    expect(edge[0]![0]).toBe(-124.48);
    // A flood reach forms an incident on its own (one is enough), so it places a focus too.
    const reach = makeHazardGeometry({
      id: asId<HazardGeometryId>('r'),
      incidentId: asId<IncidentId>('nwps-unassigned'),
      sourceId: asId<SourceId>('sr-2'),
      kind: 'FLOOD_REACH',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-121.9, 38.5],
            [-121.8, 38.5],
            [-121.8, 38.6],
            [-121.9, 38.6],
            [-121.9, 38.5],
          ],
        ],
      },
      observedAt: '2026-09-14T10:00:00Z',
    });
    expect(focusOf([reach], region)).toHaveLength(1);
    expect(focusOf([], region)).toEqual([]);
    // Fewer hotspots than a cluster needs ⇒ no incident ⇒ no focus.
    expect(focusOf([hot('g', -121.6, 39.7)], region)).toEqual([]);
  });
});

describe('a MOCK answer never places the focus nor founds a discovered incident (review, PR #34)', () => {
  it('with every hazard source on its MOCK rung, the lifeline sources are asked about the region', async () => {
    const counting = registry();
    const focusSeen: (readonly (readonly number[])[] | undefined)[] = [];
    const overpass = counting.get('osm-overpass')!;
    counting.set('osm-overpass', {
      ...overpass,
      fetch: (region) => {
        focusSeen.push(region.focus);
        return overpass.fetch(region);
      },
    });
    await assembleLiveMapSeed(counting, { 'us-ca': DEFAULT_MAP_SEED['us-ca']! }, clock, regions());
    expect(focusSeen.length).toBeGreaterThan(0);
    expect(focusSeen.every((f) => f === undefined)).toBe(true);
  });
});
