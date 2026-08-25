// BEACON — live-composition tests (Phase-B integration seam; Art. XVI fail-open). Proves assembleLiveSeeds:
// (1) returns null unless DATA_SOURCE_COMPOSITION=adapters (offline default preserved); (2) in adapters mode
// assembles BOTH the core + map seeds with mode-labelled provenance; (3) fail-open — any registry failure
// (a LIVE adapter missing its required key) returns null so the caller keeps DEFAULT_SEED and never dead-ends.
// Deterministic: all adapters MOCK, fixed clock/idGen, NO network.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '@/config/index.js';
import { makeInMemoryCache } from '@/adapters/cache/in-memory-cache.js';
import type { LoadedRegion, RegionRegistry } from '@/adapters/persistence/region-registry.js';
import { assembleLiveSeeds, buildRegionRegistries } from './live-composition.js';
import { buildAdapterRegistry, loadManifest } from './adapter-registry.js';
import { isOk } from '@/domain/shared/result.js';

const NOW = '2026-07-05T22:00:00Z';
const clock = (): string => NOW;
const newId = ((): ((p: string) => string) => {
  let n = 0;
  return (p) => `${p}-${++n}`;
})();

const fixed = { nowIso: () => NOW, idGen: ((): (() => string) => { let n = 0; return () => `sr-${++n}`; })() };

/** All SOURCE_<PREFIX>_MODE=MOCK except one prefix left unset (so its region override / manifest mode shows). */
function envMockExcept(exclude: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ALL_MOCK).filter(([k]) => k !== `SOURCE_${exclude}_MODE`),
  ) as Record<string, string>;
}

/**
 * A minimal RegionRegistry — buildRegionRegistries hands the whole LoadedRegion to `build`, which reads
 * configId, sourceModeOverrides and the region's enabled_adapters ALLOWLIST (B1.3). `enabled` defaults to
 * the full manifest id set so a test that is not about the allowlist keeps every source available.
 */
function fakeRegions(
  regions: readonly { configId: string; overrides: Record<string, string>; enabled?: readonly string[] }[],
): RegionRegistry {
  return {
    defaultRegionId: regions[0]?.configId ?? 'us-ca',
    regions: regions.map((r) => ({
      configId: r.configId,
      sourceModeOverrides: r.overrides,
      region: { enabledAdapters: r.enabled ?? ALL_MANIFEST_IDS },
    })),
  } as unknown as RegionRegistry;
}

// Every manifest source, forced MOCK so the whole live assembly is deterministic + offline. W2a's enrich
// fns consume the full catalogue (news/intel + infra/outage/cell/floodzone/population), so any LIVE-default
// source left unmocked would attempt a real network fetch.
//
// DERIVED FROM THE MANIFEST, NOT HAND-LISTED (fixed 2026-08-08). Both lists below used to be hand-kept
// arrays, and both had silently fallen behind: neither ever gained the three B3 aggregators
// (`meteoalarm-gr`/`-es`/`wmo-swic`, added 2026-07-27). That omission was harmless ONLY because those
// three default CACHED — the day one flips LIVE, this "no network" test starts making real requests.
// Reading the manifest makes the mock set correct by construction instead of by vigilance.
const manifestRes = loadManifest();
if (!isOk(manifestRes)) throw new Error(`adapter manifest unreadable: ${manifestRes.error.message}`);
// THE PREFIX IS READ FROM THE MANIFEST, NOT DERIVED FROM THE ID (fixed 2026-08-11, PR#7 review).
// Deriving it as `id.replace(/-/g,'_').toUpperCase()` was WRONG for any entry whose declared
// `configPrefix` is not the mechanical transform of its id — `agency-rss` declares `AGENCYRSS`, so this
// file was setting `SOURCE_AGENCY_RSS_MODE`, a key nothing reads. agency-rss defaults **LIVE**, so the
// "whole live assembly is deterministic + offline" claim below was false: that adapter really did fetch.
// `configPrefix` is exactly what the composition root keys on (`resolveEntryEnv`,
// adapter-registry.ts:235), so reading it here makes the mock set correct by construction — the same
// derive-from-the-manifest discipline the block above establishes, now applied to the KEY as well as the
// SET. Every one of the 44 entries declares one; an entry without one gets no mode knob in production
// either, so there would be nothing to force.
const ALL_MOCK: Readonly<Record<string, string>> = Object.fromEntries(
  manifestRes.value.adapters
    .filter((a) => a.configPrefix !== undefined)
    .map((a) => [`SOURCE_${a.configPrefix!}_MODE`, 'MOCK']),
);

/** Every manifest id — the "no allowlist restriction" default for the fake regions below. */
const ALL_MANIFEST_IDS: readonly string[] = manifestRes.value.adapters.map((a) => a.id);

describe('assembleLiveSeeds (Phase-B live composition)', () => {
  it('returns null when DATA_SOURCE_COMPOSITION is unset or "seed" (offline default preserved)', async () => {
    const config = loadConfig({});
    expect(await assembleLiveSeeds(config, {}, clock, newId)).toBeNull();
    expect(await assembleLiveSeeds(config, { DATA_SOURCE_COMPOSITION: 'seed' }, clock, newId)).toBeNull();
  });

  it('adapters mode (all MOCK) assembles core + map seeds with mode-labelled provenance', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live).not.toBeNull();
    expect(live!.coreSeed.incidents.length).toBeGreaterThan(0);
    // The per-region source projection is refreshed from the enriched provenance (read by GET /status).
    const caSources = live!.coreSeed.sources['us-ca'] ?? [];
    expect(caSources.length).toBeGreaterThan(0);
    expect(caSources.every((s) => ['LIVE', 'CACHED', 'MOCK'].includes(s.mode))).toBe(true);
    expect(Object.keys(live!.mapSeed).length).toBeGreaterThan(0);
  });

  it('fail-open: a LIVE adapter without its required key → registry Err → null (never dead-ends, Art. XVI)', async () => {
    // firms LIVE without FIRMS_MAP_KEY ⇒ source-config fail-fast ⇒ buildAdapterRegistry Err ⇒ null.
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' };
    expect(await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId)).toBeNull();
  });

  // The LABELLED fail-open (2026-08-04). The silent version of the guard above cost a full debugging
  // session in the field: four .env rows each fail-fasted a whole region and "every source is MOCK" had
  // zero diagnostic. The label is therefore a tested behaviour, not a courtesy: under BEACON_DEBUG_LIVE=1
  // (or LOG_LEVEL=debug) the diagnostic must NAME the failing region and the exact row error; without the
  // flag it must stay silent exactly as before.
  it('labelled fail-open: BEACON_DEBUG_LIVE=1 names the region + row error; silent without the flag', async () => {
    const { vi } = await import('vitest');
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Without the flag: fail-open stays SILENT (the pre-existing contract).
      expect(await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      // With the flag: same null, but the reason is printed with region + row + fallback label.
      const debugEnv = { ...rawEnv, BEACON_DEBUG_LIVE: '1' };
      expect(await assembleLiveSeeds(loadConfig(debugEnv), debugEnv, clock, newId)).toBeNull();
      const printed = spy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('[live-composition]');
      expect(printed).toContain('registry build failed');
      expect(printed).toContain('FIRMS: LIVE mode requires FIRMS_MAP_KEY');
      expect(printed).toContain('falling back to offline seed');
    } finally {
      spy.mockRestore();
    }
  });

  // B1 — per-region composition END-TO-END through the real config/regions.json: each region is enriched
  // under its OWN registry (built from that region's source_mode_overrides), so RO's flood source (glofas)
  // is fetched for RO and NEVER leaks into CA. (The override→mode precedence itself is proven, without the
  // CACHED-empty-cache→MOCK fetch degradation confounding it, by the buildRegionRegistries unit tests below.)
  it('composes each region under its own registry; a region-scoped source never leaks into another region', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live).not.toBeNull();
    const ro = live!.coreSeed.incidents.find((i) => i.regionId === 'ro')!;
    const ca = live!.coreSeed.incidents.find((i) => i.regionId === 'us-ca')!;
    // RO's registry served glofas (an RO-enabled flood source) into RO's provenance…
    expect(ro.provenance.some((p) => p.sourceId === 'glofas')).toBe(true);
    // …and it never bleeds into CA (US flagship path never fetches glofas). Per-region source projections too.
    expect(ca.provenance.some((p) => p.sourceId === 'glofas')).toBe(false);
    expect((live!.coreSeed.sources['us-ca'] ?? []).some((s) => s.sourceId === 'glofas')).toBe(false);
    expect((live!.coreSeed.sources['ro'] ?? []).some((s) => s.sourceId === 'glofas')).toBe(true);
  });

  // B1.3 (F-05) END-TO-END through the real config/regions.json: the enforced allowlist restricts each
  // region to its configured sources WITHOUT dropping any layer the composition genuinely serves. The second
  // half matters most: an under-specified allowlist would silently delete working data (CA's weather layer
  // and every camera pin, RO's cell sites), which is exactly the failure mode enforcing a stale list causes.
  it('the enforced allowlist restricts each region to its configured sources without dropping a served layer', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live).not.toBeNull();
    const ca = live!.mapSeed['us-ca']!;
    const ro = live!.mapSeed['ro']!;
    // Assert on PROVENANCE, not on layerSources: a layer badge falls back to its SEEDED stamp when nothing
    // serves, so `layerSources.weather === 'open-meteo'` stays green even if open-meteo is gated out — it
    // cannot distinguish served from seeded. provenance carries a ref ONLY for a slice the adapter actually
    // served (or a covered-but-down source), so it is the honest witness that the source was consulted.
    const cited = (input: typeof ca, id: string): boolean => input.provenance.some((p) => p.sourceId === id);
    // CA: every source it enables and consumes is cited (weather from open-meteo, cameras from caltrans-cctv…).
    for (const id of ['firms', 'nifc', 'open-meteo', 'osm-overpass', 'opencellid', 'nfhl', 'eagle-i', 'caltrans-cctv', 'alertwildfire']) {
      expect(cited(ca, id), `us-ca must cite '${id}'`).toBe(true);
    }
    expect((ca.cameras ?? []).length).toBeGreaterThan(0);
    // RO: its own sources serve (EU flood + global cells + RO cameras); the seeded layer badges stay honest.
    for (const id of ['glofas', 'effis', 'open-meteo', 'osm-overpass', 'opencellid', 'cnadnr-ro']) {
      expect(cited(ro, id), `ro must cite '${id}'`).toBe(true);
    }
    expect(ro.layerSources).toMatchObject({ flood: 'glofas', cell: 'opencellid', cameras: 'cnadnr-ro' });
    expect((ro.cellSites ?? []).length).toBeGreaterThan(0);
    for (const id of ['nwps', 'nifc', 'census', 'eagle-i', 'nfhl', 'caltrans-cctv']) {
      expect(cited(ro, id), `ro must not cite '${id}'`).toBe(false);
    }
    // And a source no region enables (itu/camara-gsma are wired but unconsumed) is cited by neither.
    for (const id of ['itu', 'camara-gsma']) {
      expect(cited(ca, id) || cited(ro, id), id).toBe(false);
    }
  });
});

// B1 — buildRegionRegistries: the per-region registry factory. Proves (a) a region override actually changes
// that region's adapter mode, (b) env SOURCE_*_MODE still WINS over the override, (c) another region is
// unaffected, and (d) it fails open (null) when any region's registry fails to build. Deterministic, no net.
describe('buildRegionRegistries (per-region override threading + isolation)', () => {
  const build = (env: Record<string, string>) => (region: LoadedRegion) =>
    buildAdapterRegistry({
      cache: makeInMemoryCache(),
      env,
      sourceModeOverrides: region.sourceModeOverrides,
      enabledAdapters: region.region.enabledAdapters,
      ...fixed,
    });

  it('(a) a region override changes that region\'s adapter mode; (c) another region is unaffected', () => {
    // glofas manifest mode = CACHED. ro overrides it to MOCK; ca has no override ⇒ ca stays CACHED (manifest).
    const regions = fakeRegions([
      { configId: 'ro', overrides: { glofas: 'MOCK' } },
      { configId: 'us-ca', overrides: {} },
    ]);
    const byRegion = buildRegionRegistries(regions, build(envMockExcept('GLOFAS')));
    expect(byRegion).not.toBeNull();
    expect(byRegion!.get('ro')!.get('glofas')!.mode).toBe('MOCK'); // override applied (a)
    expect(byRegion!.get('us-ca')!.get('glofas')!.mode).toBe('CACHED'); // isolation — manifest default (c)
  });

  it('(b) env SOURCE_*_MODE WINS over a region override', () => {
    const regions = fakeRegions([{ configId: 'ro', overrides: { glofas: 'MOCK' } }]);
    // env sets glofas=CACHED; the region override says MOCK — env must win ⇒ CACHED.
    const byRegion = buildRegionRegistries(regions, build({ ...ALL_MOCK, SOURCE_GLOFAS_MODE: 'CACHED' }));
    expect(byRegion!.get('ro')!.get('glofas')!.mode).toBe('CACHED');
  });

  it('(d) fails open (null) when any region\'s registry fails to build (LIVE without key)', () => {
    // firms LIVE without FIRMS_MAP_KEY ⇒ buildAdapterRegistry CONFIG Err ⇒ buildRegionRegistries returns null.
    // The region must ENABLE firms for that to be its problem at all (B1.3) — see the next test.
    const regions = fakeRegions([{ configId: 'ro', overrides: {}, enabled: ['firms', 'glofas'] }]);
    const byRegion = buildRegionRegistries(regions, build({ SOURCE_FIRMS_MODE: 'LIVE' }));
    expect(byRegion).toBeNull();
  });

  // B1.3 (F-05): the allowlist is threaded per region, so each region gets ONLY the sources it enables…
  it('(e) each region\'s registry holds ONLY that region\'s enabled_adapters', () => {
    const regions = fakeRegions([
      { configId: 'ro', overrides: { glofas: 'MOCK' }, enabled: ['glofas', 'gdacs', 'open-meteo'] },
      { configId: 'us-ca', overrides: {}, enabled: ['firms', 'nws'] },
    ]);
    const byRegion = buildRegionRegistries(regions, build(ALL_MOCK as Record<string, string>));
    expect(byRegion).not.toBeNull();
    expect([...byRegion!.get('ro')!.keys()].sort()).toEqual(['gdacs', 'glofas', 'open-meteo']);
    expect([...byRegion!.get('us-ca')!.keys()].sort()).toEqual(['firms', 'nws']);
  });

  // …and a source-config failure on a row a region does NOT enable can no longer take that region down:
  // firms is LIVE-without-key here, but RO never enabled it, so RO still composes (Art. XVI).
  it('(f) a LIVE-without-key source a region did not enable does not break that region', () => {
    const regions = fakeRegions([{ configId: 'ro', overrides: {}, enabled: ['glofas', 'gdacs'] }]);
    const byRegion = buildRegionRegistries(regions, build({ ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' }));
    expect(byRegion).not.toBeNull();
    expect(byRegion!.get('ro')!.has('firms')).toBe(false);
  });
});
