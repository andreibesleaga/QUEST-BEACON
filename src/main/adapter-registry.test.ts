// BEACON — adapter-registry tests (Phase-B B1; FR-10 manifest, adapter-contract §5, Art. XVI). Proves the
// previously-absent runtime caller for config/adapters.json + the 8 make*Adapter factories: it loads and
// VALIDATES the manifest, builds a registry keyed by manifest id, fails fast (no throw) on a bad row or a
// LIVE-without-key config, exposes each adapter's outward domain port, and honours mode precedence
// (env > region-override > manifest). Deterministic: all adapters MOCK, fixed clock/idGen, NO network.
import { describe, it, expect } from 'vitest';
import { makeInMemoryCache } from '@/adapters/cache/in-memory-cache.js';
import type { Manifest } from '@/adapters/_shared/index.js';
import type { HazardSourcePort, FloodGaugePort, WeatherSourcePort } from '@/ports/data-sources.js';
import type { NewsIntelPort } from '@/ports/intel.js';
import type { InfrastructurePort, OutagePort, TelecomPort, PopulationPort } from '@/ports/infrastructure-sources.js';
import type { FloodZonePort } from '@/adapters/sources/nfhl/nfhl-adapter.js';
import type { CameraDirectoryPort } from '@/ports/cameras.js';
import type { AirQualityPort } from '@/ports/air-quality.js';
import { isOk } from '@/domain/shared/result.js';
import { loadRegionRegistry } from '@/adapters/persistence/region-registry.js';
import { ADAPTER_FACTORIES, loadManifest, buildAdapterRegistry } from './adapter-registry.js';

const NOW = '2026-07-05T22:00:00Z';
const fixed = { nowIso: () => NOW, idGen: ((): (() => string) => { let n = 0; return () => `sr-${++n}`; })() };
const ALL_IDS = [
  'firms', 'nws', 'nwps', 'glofas', 'gdacs', 'meteoalarm-ro', 'open-meteo', 'usgs-water',
  // Phase-D catalog completion (W1):
  'gdelt', 'reliefweb', 'agency-rss', 'bluesky', 'mastodon', 'metno', 'anm', 'hdxpop', 'hifld', 'eonet', 'cemsrm', 'openfema', 'caphub', 'lanceflood', 'nri', 'nifc', 'effis', 'osm-overpass',
  'worldpop', 'census', 'nfhl', 'eagle-i', 'opencellid', 'itu', 'camara-gsma',
  // Live Views (CW1): camera directories
  'caltrans-cctv', 'alertwildfire', 'windy-webcams', 'dot511', 'cnadnr-ro',
  // B3 aggregators (B3.1/B3.2): MeteoAlarm per-country feeds on ONE generic adapter + the WMO-SWIC CAP
  // relay. Enabled by the three B3.3 zones (es/gr/ph) — see the ownership test below.
  'meteoalarm-gr', 'meteoalarm-es', 'wmo-swic',
  // S3 Lane A: the AirQuality trio (P17), held at S2 on F-52 and registered with its SitRep consumer
  // (derive-cop's air-quality threshold fact via the live-seed `airQuality` slot).
  'openaq', 'airnow', 'sensorcommunity',
];
const ALL_MOCK: Readonly<Record<string, string>> = Object.fromEntries(ALL_IDS.map((id) => [id, 'MOCK']));

function build(env: Record<string, string | undefined> = {}, overrides = ALL_MOCK, manifest?: Manifest) {
  return buildAdapterRegistry({ cache: makeInMemoryCache(), env, sourceModeOverrides: overrides, ...fixed, ...(manifest ? { manifest } : {}) });
}

/** Build with a region's enabled_adapters ALLOWLIST applied (the B1.3 region-scoped call shape). */
function buildAllowed(enabledAdapters: readonly string[], env: Record<string, string | undefined> = {}) {
  return buildAdapterRegistry({ cache: makeInMemoryCache(), env, sourceModeOverrides: ALL_MOCK, enabledAdapters, ...fixed });
}

describe('loadManifest', () => {
  it('loads + validates the shipped config/adapters.json', () => {
    const res = loadManifest();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.adapters).toHaveLength(44);
  });

  it('has a registered factory for every manifest id', () => {
    const res = loadManifest();
    if (!res.ok) throw new Error('manifest failed');
    for (const entry of res.value.adapters) {
      expect(typeof ADAPTER_FACTORIES[entry.id]).toBe('function');
    }
  });

  // REGRESSION PIN (2026-08-11, PR#7 review). Two test files built their force-everything-MOCK env by
  // DERIVING the key as `id.replace(/-/g,'_').toUpperCase()`. That silently disagrees with any declared
  // `configPrefix` — `agency-rss` declares `AGENCYRSS`, not `AGENCY_RSS` — so those
  // files emitted a key nothing reads, and because agency-rss defaults LIVE their "offline, no-network"
  // runs really did fetch. Both now read `configPrefix` (what `resolveEntryEnv` keys on).
  //
  // This test pins the two facts that make guessing unsafe, so the shortcut cannot look harmless again:
  // every entry declares a prefix, and at least one provably differs from the mechanical transform.
  it('every entry declares configPrefix, and the mechanical id transform is NOT a safe substitute', () => {
    const res = loadManifest();
    if (!res.ok) throw new Error('manifest failed');
    const mechanical = (id: string): string => id.replace(/-/g, '_').toUpperCase();

    for (const entry of res.value.adapters) {
      expect(entry.configPrefix, `${entry.id} declares no configPrefix — SOURCE_<PREFIX>_MODE is unaddressable`).toBeDefined();
    }
    const divergent = res.value.adapters.filter((a) => a.configPrefix !== mechanical(a.id));
    expect(
      divergent.length,
      'no entry diverges from the mechanical transform any more — keep reading configPrefix regardless: this test exists to stop the shortcut returning, and a future row may diverge again',
    ).toBeGreaterThan(0);
  });
});

describe('buildAdapterRegistry', () => {
  it('builds a registry with all 44 manifest ids', () => {
    const res = build();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.value.keys()].sort()).toEqual([...ALL_IDS].sort());
  });

  it('exposes each adapter outward domain port (firms→fetchHazards, nwps→fetchGauges, open-meteo→fetchWeather, meteoalarm-ro→fetchNews)', () => {
    const res = build();
    if (!res.ok) throw new Error('build failed');
    const reg = res.value;
    expect(typeof (reg.get('firms') as unknown as HazardSourcePort).fetchHazards).toBe('function');
    expect(typeof (reg.get('nwps') as unknown as FloodGaugePort).fetchGauges).toBe('function');
    expect(typeof (reg.get('open-meteo') as unknown as WeatherSourcePort).fetchWeather).toBe('function');
    expect(typeof (reg.get('meteoalarm-ro') as unknown as NewsIntelPort).fetchNews).toBe('function');
  });

  it('exposes each Phase-D (W1) adapter outward domain port (gdelt→fetchNews, nifc→fetchHazards, osm-overpass→fetchNodes, worldpop→estimatePopulation, eagle-i→fetchOutages, opencellid→fetchCoverage, nfhl→fetchZones)', () => {
    const res = build();
    if (!res.ok) throw new Error('build failed');
    const reg = res.value;
    expect(typeof (reg.get('gdelt') as unknown as NewsIntelPort).fetchNews).toBe('function');
    expect(typeof (reg.get('nifc') as unknown as HazardSourcePort).fetchHazards).toBe('function');
    expect(typeof (reg.get('osm-overpass') as unknown as InfrastructurePort).fetchNodes).toBe('function');
    expect(typeof (reg.get('worldpop') as unknown as PopulationPort).estimatePopulation).toBe('function');
    expect(typeof (reg.get('eagle-i') as unknown as OutagePort).fetchOutages).toBe('function');
    expect(typeof (reg.get('opencellid') as unknown as TelecomPort).fetchCoverage).toBe('function');
    expect(typeof (reg.get('nfhl') as unknown as FloodZonePort).fetchZones).toBe('function');
  });

  it('exposes each B3 aggregator outward domain port (meteoalarm-gr/-es + wmo-swic → fetchNews)', () => {
    const res = build();
    if (!res.ok) throw new Error('build failed');
    const reg = res.value;
    for (const id of ['meteoalarm-gr', 'meteoalarm-es', 'wmo-swic']) {
      expect(typeof (reg.get(id) as unknown as NewsIntelPort).fetchNews, id).toBe('function');
      expect(reg.get(id)?.id, id).toBe(id); // each row builds its OWN identity (no alias collision)
    }
    // The widened generic adapter did NOT change the RO row's identity/coverage (B3.1 backward compat).
    expect(reg.get('meteoalarm-ro')?.coverage).toEqual({ kind: 'COUNTRIES', iso: ['RO'] });
    expect(reg.get('meteoalarm-gr')?.coverage).toEqual({ kind: 'COUNTRIES', iso: ['GR'] });
    expect(reg.get('wmo-swic')?.coverage).toEqual({ kind: 'COUNTRIES', iso: ['PH'] });
  });

  // Was: "the B3 aggregator rows are enabled by NO shipped region yet" — written in B3.6 to FAIL LOUDLY the
  // moment B3.3 shipped the zones, rather than letting that state drift silently. B3.3 has now shipped, so
  // the test asserts the state that replaced it, and asserts MORE than the old one did: not merely that each
  // aggregator is enabled somewhere, but that it is enabled by EXACTLY the region(s) its COUNTRIES coverage
  // actually covers. That generalises to every country-scoped row in the manifest, so a national source
  // wired to the wrong zone (meteoalarm-ro on `es`, say) is dead config the allowlist would never build —
  // caught here instead of showing up as a silently missing layer.
  it('every country-scoped adapter is enabled by exactly the zones its ISO coverage covers (B3.3)', () => {
    const reg = loadRegionRegistry();
    if (!isOk(reg)) throw new Error('region registry failed');
    const manifest = loadManifest();
    if (!manifest.ok) throw new Error('manifest failed');
    const regions = reg.value.regions;
    const enablers = (id: string): string[] =>
      regions.filter((r) => r.region.enabledAdapters.includes(id)).map((r) => r.configId).sort();

    // The three B3 aggregator rows, named explicitly: this is the state B3.3 was required to produce.
    expect(enablers('meteoalarm-es')).toEqual(['es']);
    expect(enablers('meteoalarm-gr')).toEqual(['gr']);
    expect(enablers('wmo-swic')).toEqual(['ph']);
    expect(enablers('meteoalarm-ro')).toEqual(['ro']); // unchanged by B3.3 — the generic adapter kept it

    // …and the general rule they are instances of. A country-scoped row may only be enabled by a region
    // whose ISO it covers; the reverse (a covered region that does not enable it) stays a free choice —
    // `enabled_adapters` is a PERMISSION list, not an obligation.
    for (const a of manifest.value.adapters) {
      if (a.coverage.kind !== 'COUNTRIES') continue;
      const covered = new Set(a.coverage.iso);
      for (const r of regions) {
        if (!r.region.enabledAdapters.includes(a.id)) continue;
        expect(
          covered.has(r.region.iso ?? ''),
          `region '${r.configId}' (${r.region.iso ?? '—'}) enables '${a.id}', which only covers ${[...covered].join('/')}`,
        ).toBe(true);
      }
    }
  });

  it('exposes each S3 AirQuality adapter outward domain port (fetchAirQuality) with its own honest coverage', () => {
    const res = build();
    if (!res.ok) throw new Error('build failed');
    const reg = res.value;
    for (const id of ['openaq', 'airnow', 'sensorcommunity']) {
      expect(typeof (reg.get(id) as unknown as AirQualityPort).fetchAirQuality, id).toBe('function');
      expect(reg.get(id)?.id, id).toBe(id);
    }
    // Coverage honesty: airnow claims NORTH AMERICA (a BBOX, matching the adapter's own declaration — not
    // GLOBAL); the aggregator + citizen network claim GLOBAL. This is what keeps airnow out of RO/ES/GR/PH.
    expect(reg.get('airnow')?.coverage).toEqual({ kind: 'BBOX', bbox: [-172, 14, -50, 72] });
    expect(reg.get('openaq')?.coverage).toEqual({ kind: 'GLOBAL' });
    expect(reg.get('sensorcommunity')?.coverage).toEqual({ kind: 'GLOBAL' });
  });

  it('exposes each Live Views (CW1) camera adapter outward domain port (fetchCameras)', () => {
    const res = build();
    if (!res.ok) throw new Error('build failed');
    const reg = res.value;
    for (const id of ['caltrans-cctv', 'alertwildfire', 'windy-webcams', 'dot511', 'cnadnr-ro']) {
      expect(typeof (reg.get(id) as unknown as CameraDirectoryPort).fetchCameras).toBe('function');
    }
  });

  it('fails fast (CONFIG Err, no throw) when a manifest row has no registered factory', () => {
    const manifest: Manifest = {
      adapters: [
        { id: 'no-such-source', port: 'HazardSource', coverage: { kind: 'GLOBAL' }, mode: 'MOCK', intervalSec: 300, license: 'PD' },
      ],
    };
    const res = build({}, {}, manifest);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('fails fast (CONFIG Err) on SOURCE_FIRMS_MODE=LIVE with no FIRMS_MAP_KEY', () => {
    const res = build({ SOURCE_FIRMS_MODE: 'LIVE' }, ALL_MOCK);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('mode precedence: env SOURCE_*_MODE wins over region override and manifest', () => {
    // open-meteo manifest mode = LIVE; region override → MOCK; env → CACHED (env must win).
    const res = build({ SOURCE_OPEN_METEO_MODE: 'CACHED' }, { ...ALL_MOCK, 'open-meteo': 'MOCK' });
    if (!res.ok) throw new Error('build failed');
    expect(res.value.get('open-meteo')?.mode).toBe('CACHED');
  });

  it('mode precedence: region override wins over manifest when env is unset', () => {
    // gdacs manifest mode = LIVE; region override → MOCK (no env) ⇒ effective MOCK.
    const res = build({}, { ...ALL_MOCK, gdacs: 'MOCK' });
    if (!res.ok) throw new Error('build failed');
    expect(res.value.get('gdacs')?.mode).toBe('MOCK');
  });

  // ── B1.3 (finding F-05): enabled_adapters is a REAL per-region allowlist ────────────────────────────
  // Before B1.3 every manifest row was built for every region, so "add a region by config" was only half
  // true: config could not stop a region from consulting a source. These tests pin the two DELIBERATE
  // semantics (omitted ≠ empty) and the degrade-not-break behaviour of a misconfigured row.
  describe('enabled_adapters allowlist', () => {
    it('restricts the registry to EXACTLY the allowlisted manifest ids', () => {
      const res = buildAllowed(['firms', 'nws', 'osm-overpass']);
      if (!res.ok) throw new Error('build failed');
      expect([...res.value.keys()].sort()).toEqual(['firms', 'nws', 'osm-overpass']);
      // The excluded rows are absent — not present-but-disabled. An absent adapter is never fetched and
      // never labelled, so a region can never be shown data from a source its config does not permit.
      expect(res.value.has('glofas')).toBe(false);
    });

    it('an OMITTED allowlist means “not region-scoped” ⇒ every manifest row is built', () => {
      // This is the documented default for the unscoped callers (per-adapter tests, the redundancy
      // acceptance harness): behaviour is byte-identical to before the field existed.
      const res = build();
      if (!res.ok) throw new Error('build failed');
      expect(res.value.size).toBe(ALL_IDS.length);
    });

    it('an EMPTY allowlist means ZERO adapters (never “all”) and is NOT an error', () => {
      // WHY this decision: `enabled_adapters` is REQUIRED by schemas/regions.schema.json, so an absent list
      // is a config error caught by the schema — the only way to reach here is an explicitly EMPTY list, and
      // the honest reading of "allow nothing" is nothing. Widening it to the full manifest would push a
      // region's queries to sources its operator deliberately did not enable (licensing/sovereignty) — the
      // exact opposite of an allowlist. It is not an Err either, because that would dead-end the WHOLE live
      // composition for every region (buildRegionRegistries fails open on any region's failure); instead the
      // region simply consults nothing and every slice keeps its hand-seeded, honestly-labelled value
      // (Art. XVI degrade-not-break). No SHIPPED region has an empty allowlist — region-registry.test.ts
      // asserts that, so this branch can never be entered silently in production.
      const res = buildAllowed([]);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.size).toBe(0);
    });

    it('an allowlisted id with NO manifest row is ignored, not fatal (drift is the test’s job, not a crash)', () => {
      const res = buildAllowed(['firms', 'totally-made-up']);
      if (!res.ok) throw new Error('build failed');
      expect([...res.value.keys()]).toEqual(['firms']); // it cannot conjure an adapter; it just grants nothing
    });

    it('a manifest row with no factory does NOT break a region that did not enable it (Art. XVI)', () => {
      const manifest: Manifest = {
        adapters: [
          { id: 'firms', port: 'HazardSource', coverage: { kind: 'GLOBAL' }, mode: 'MOCK', intervalSec: 300, configPrefix: 'FIRMS', license: 'PD' },
          { id: 'no-such-source', port: 'HazardSource', coverage: { kind: 'GLOBAL' }, mode: 'MOCK', intervalSec: 300, license: 'PD' },
        ],
      };
      const deps = { cache: makeInMemoryCache(), env: { SOURCE_FIRMS_MODE: 'MOCK' }, manifest, ...fixed };
      // Region enables only the wired row ⇒ builds fine (the broken row is not its problem).
      const scoped = buildAdapterRegistry({ ...deps, enabledAdapters: ['firms'] });
      expect(scoped.ok).toBe(true);
      if (scoped.ok) expect([...scoped.value.keys()]).toEqual(['firms']);
      // …but a region that DOES enable it still fails fast, and so does every unscoped caller.
      expect(buildAdapterRegistry({ ...deps, enabledAdapters: ['firms', 'no-such-source'] }).ok).toBe(false);
      expect(buildAdapterRegistry(deps).ok).toBe(false);
    });

    it('the SHIPPED regions get exactly their own configured sources (no cross-region leakage)', () => {
      const reg = loadRegionRegistry();
      if (!isOk(reg)) throw new Error('region registry failed');
      const built = new Map(
        reg.value.regions.map((r) => {
          const res = buildAllowed(r.region.enabledAdapters);
          if (!res.ok) throw new Error(`registry build failed for ${r.configId}: ${res.error.message}`);
          return [r.configId, new Set(res.value.keys())] as const;
        }),
      );
      const ca = built.get('us-ca')!;
      const ro = built.get('ro')!;
      // The EU/RO-scoped sources are not even instantiated for California…
      for (const id of ['glofas', 'effis', 'meteoalarm-ro', 'cnadnr-ro']) expect(ca.has(id), id).toBe(false);
      // …nor the US-only ones for Romania (belt AND braces: the coverage gate would also return NOT_COVERED).
      for (const id of ['nwps', 'nifc', 'census', 'eagle-i', 'nfhl', 'usgs-water', 'caltrans-cctv']) {
        expect(ro.has(id), id).toBe(false);
      }
      // Every source the live composition actually consults for a region IS enabled for it — otherwise
      // enforcing the allowlist would silently delete a working layer (CA weather, cameras, RO cell sites).
      for (const id of ['firms', 'nifc', 'open-meteo', 'osm-overpass', 'worldpop', 'census', 'eagle-i', 'nws',
        'gdacs', 'gdelt', 'reliefweb', 'agency-rss', 'bluesky', 'nwps', 'opencellid', 'nfhl',
        'caltrans-cctv', 'alertwildfire', 'dot511', 'windy-webcams']) {
        expect(ca.has(id), `us-ca must enable '${id}'`).toBe(true);
      }
      for (const id of ['glofas', 'effis', 'open-meteo', 'osm-overpass', 'worldpop', 'gdacs', 'gdelt',
        'reliefweb', 'agency-rss', 'bluesky', 'meteoalarm-ro', 'opencellid', 'cnadnr-ro', 'windy-webcams']) {
        expect(ro.has(id), `ro must enable '${id}'`).toBe(true);
      }
    });
  });

  it('falls back to manifest mode when neither env nor override is set', () => {
    // usgs-water manifest mode = MOCK (safe, no net) with no override/env ⇒ effective MOCK.
    const overrides = Object.fromEntries(ALL_IDS.filter((id) => id !== 'usgs-water').map((id) => [id, 'MOCK']));
    const res = build({}, overrides);
    if (!res.ok) throw new Error('build failed');
    expect(res.value.get('usgs-water')?.mode).toBe('MOCK');
  });
});
