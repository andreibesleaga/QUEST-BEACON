// BEACON — live-composition tests (Phase-B integration seam; Art. XVI fail-open). Proves assembleLiveSeeds:
// (1) returns null unless DATA_SOURCE_COMPOSITION=adapters (offline default preserved); (2) in adapters mode
// assembles BOTH the core + map seeds with mode-labelled provenance; (3) fail-open — any registry failure
// (a LIVE adapter missing its required key) returns null so the caller keeps DEFAULT_SEED and never dead-ends.
// Deterministic: all adapters MOCK, fixed clock/idGen, NO network.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '@/config/index.js';
import { makeInMemoryCache } from '@/adapters/cache/in-memory-cache.js';
import type { LoadedRegion, RegionRegistry } from '@/adapters/persistence/region-registry.js';
import {
  assembleLiveSeeds,
  buildRegionRegistries,
  liveOverlay,
  resetLiveRuleState,
} from './live-composition.js';
import { DEFAULT_MAP_SEED } from './map-seed.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  HazardGeometryId,
  IncidentId,
  InfrastructureNodeId,
  RegionId,
  SourceId,
  ThresholdRuleId,
} from '@/domain/value-objects/ids.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { deriveDraftAlertProposals } from '@/application/derivation/derive-alerts.js';
import { announceRefresh } from '@/adapters/channels/http/http-dispatcher.js';
import { DEFAULT_SEED } from './seed.js';
import { buildAdapterRegistry, loadManifest } from './adapter-registry.js';
import { isOk } from '@/domain/shared/result.js';

const NOW = '2026-07-05T22:00:00Z';
const clock = (): string => NOW;
const newId = ((): ((p: string) => string) => {
  let n = 0;
  return (p) => `${p}-${++n}`;
})();

const fixed = {
  nowIso: () => NOW,
  idGen: ((): (() => string) => {
    let n = 0;
    return () => `sr-${++n}`;
  })(),
};

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
  regions: readonly {
    configId: string;
    overrides: Record<string, string>;
    enabled?: readonly string[];
  }[],
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
if (!isOk(manifestRes))
  throw new Error(`adapter manifest unreadable: ${manifestRes.error.message}`);
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
const ALL_MOCK: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    manifestRes.value.adapters
      .filter((a) => a.configPrefix !== undefined)
      .map((a) => [`SOURCE_${a.configPrefix!}_MODE`, 'MOCK']),
  ),
  // These tests describe the HYBRID picture (seeded demo enriched by live slices). Since 2026-09-14 the
  // adapters posture defaults to live-only (ADR-043), which with every source MOCK shows nothing at all —
  // the live-only behaviour has its own describe below.
  LIVE_PICTURE: 'hybrid',
};

/** Every manifest id — the "no allowlist restriction" default for the fake regions below. */
const ALL_MANIFEST_IDS: readonly string[] = manifestRes.value.adapters.map((a) => a.id);

describe('assembleLiveSeeds (Phase-B live composition)', () => {
  it('returns null when DATA_SOURCE_COMPOSITION is unset or "seed" (offline default preserved)', async () => {
    const config = loadConfig({});
    expect(await assembleLiveSeeds(config, {}, clock, newId)).toBeNull();
    expect(
      await assembleLiveSeeds(config, { DATA_SOURCE_COMPOSITION: 'seed' }, clock, newId),
    ).toBeNull();
  });

  it('adapters mode (all MOCK) assembles core + map seeds with mode-labelled provenance', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live).not.toBeNull();
    expect(live!.coreSeed.incidents.length).toBeGreaterThan(0);
    // Every seeded incident survives, AND at least one incident the assembly DISCOVERED from live hazards
    // survives the composition seam. Until 2026-09-13 this seam rebuilt the list from DEFAULT_SEED by id and
    // dropped every discovered incident — a `length > 0` check could not see it.
    const ids = live!.coreSeed.incidents.map((i) => String(i.id));
    for (const seeded of DEFAULT_SEED.incidents) expect(ids).toContain(String(seeded.id));
    expect(ids.some((id) => id.startsWith('discovered:'))).toBe(true);
    expect(ids.indexOf(String(DEFAULT_SEED.incidents[0]!.id))).toBe(0); // seeded first, in seeded order
    // The per-region source projection is refreshed from the enriched provenance (read by GET /status).
    const caSources = live!.coreSeed.sources['us-ca'] ?? [];
    expect(caSources.length).toBeGreaterThan(0);
    expect(caSources.every((s) => ['LIVE', 'CACHED', 'MOCK'].includes(s.mode))).toBe(true);
    expect(Object.keys(live!.mapSeed).length).toBeGreaterThan(0);
  });

  // ── ADR-039: the durable provenance mirror ────────────────────────────────────────────────────────
  // `/sources` was EMPTY on the postgres deployment because nothing wrote provenance at runtime. These
  // prove the sink is actually COMPOSED (the register's whole complaint about sitrep/evac_route is that
  // they were built and called by nothing), that it mirrors the SAME projection the API renders, and that
  // it can never take the COP down with it.

  it('records the assembled sources into the provenance sink (postgres posture)', async () => {
    const recorded: Array<readonly { sourceId: string; mode: string; fetchedAt: string }[]> = [];
    const sink = {
      record: async (entries: readonly { sourceId: string; mode: string; fetchedAt: string }[]) => {
        recorded.push(entries);
        return { ok: true as const, value: undefined };
      },
    };
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId, sink);
    expect(live).not.toBeNull();
    expect(recorded).toHaveLength(1);
    const entries = recorded[0]!;
    expect(entries.length).toBeGreaterThan(0);
    // The mirror must be the SAME projection GET /status renders — row and screen cannot be allowed to drift.
    const projected = Object.values(live!.coreSeed.sources).flat();
    expect(new Set(entries.map((e) => e.sourceId))).toEqual(
      new Set(projected.map((s) => s.sourceId)),
    );
    expect(entries.every((e) => ['LIVE', 'CACHED', 'MOCK'].includes(e.mode))).toBe(true);
  });

  it('writes NOTHING when no sink is composed — the memory posture is byte-identical', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const withSink = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId, undefined);
    expect(withSink).not.toBeNull();
    expect(withSink!.coreSeed.sources).toEqual(
      (await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId))!.coreSeed.sources,
    );
  });

  it('FAILS OPEN when the sink errors — provenance is a record, never a gate on serving (Art. XVI)', async () => {
    const sink = {
      record: async () => ({ ok: false as const, error: new Error('db down') as never }),
    };
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId, sink);
    expect(live).not.toBeNull(); // the COP is served exactly as if the database did not exist
    expect(live!.coreSeed.incidents.length).toBeGreaterThan(0);
  });

  it('FAILS OPEN when the sink THROWS (a driver can reject outside the Result contract)', async () => {
    const sink = {
      record: async (): Promise<never> => {
        throw new Error('connection terminated unexpectedly');
      },
    };
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId, sink);
    expect(live).not.toBeNull();
  });

  it('mirrors the COP incidents into the incident sink, keyed by the ids the COP itself uses', async () => {
    const recorded: Array<
      readonly { incidentId: string; regionId: string; type: string; status: string }[]
    > = [];
    const sink = {
      record: async (
        snaps: readonly { incidentId: string; regionId: string; type: string; status: string }[],
      ) => {
        recorded.push(snaps);
        return { ok: true as const, value: undefined };
      },
    };
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId, undefined, sink);
    expect(live).not.toBeNull();
    expect(recorded).toHaveLength(1);
    // Domain ids, not surrogates: the row must be recognisable as the incident the operator is looking at.
    expect(recorded[0]!.map((s) => s.incidentId)).toEqual(
      live!.coreSeed.incidents.map((i) => i.id),
    );
    expect(recorded[0]!.every((s) => s.regionId !== '' && s.type !== '')).toBe(true);
  });

  it('a failing incident sink costs neither the COP nor the provenance record (independent fail-open)', async () => {
    const provenance: unknown[] = [];
    const provenanceSink = {
      record: async (e: readonly unknown[]) => {
        provenance.push(...e);
        return { ok: true as const, value: undefined };
      },
    };
    const incidentSink = {
      record: async (): Promise<never> => {
        throw new Error('incident write failed');
      },
    };
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const live = await assembleLiveSeeds(
      loadConfig(rawEnv),
      rawEnv,
      clock,
      newId,
      provenanceSink,
      incidentSink,
    );
    expect(live).not.toBeNull();
    expect(provenance.length).toBeGreaterThan(0); // the more load-bearing record still landed
  });

  // REWRITTEN 2026-09-12. This test used to assert that firms LIVE-without-key made the WHOLE assembly
  // return null — the offline seed for every region, every source MOCK. That is the exact production
  // outage of 2026-09-12 (SOURCE_EAGLE_I_MODE=live with no endpoint ⇒ 37 healthy sources served the
  // fixture for hours), and it was pinned here as "never dead-ends". It was the dead-end. The registry now
  // excludes the one row that cannot be built and composes the rest.
  it('a LIVE adapter without its required key is EXCLUDED; every other source still composes (Art. XVI)', async () => {
    const { vi } = await import('vitest');
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' };
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
      expect(live).not.toBeNull(); // the picture is live, minus one source
      const printed = spy.mock.calls.map((c) => String(c[0])).join('\n');
      // ...and the exclusion is said out loud, unconditionally, naming the row and the factory's own reason.
      expect(printed).toContain('source excluded from registry: firms');
      expect(printed).toContain('FIRMS_MAP_KEY');
    } finally {
      spy.mockRestore();
    }
  });

  // The LABELLED fail-open (2026-08-04) was pinned on firms LIVE-without-key: under BEACON_DEBUG_LIVE=1
  // the composition printed "registry build failed … FIRMS_MAP_KEY … falling back to offline seed".
  // Since 2026-09-12 that case never reaches the composition's fail-open at all — the registry excludes
  // the row and reports it on stderr itself — so the flag has nothing to say here and the picture is live.
  // Pinned as silence on purpose: a stale "falling back to offline seed" line for a region that did NOT
  // fall back would be a label that lies. (The debugLive label survives in live-composition.ts for the
  // one case that can still fail a region — a manifest/code disagreement — which the registry unit tests
  // pin at the registry level; there is no public seam to inject a bad manifest through assembleLiveSeeds.)
  it('BEACON_DEBUG_LIVE=1 no longer reports a registry failure for a LIVE-without-key row — there is none', async () => {
    const { vi } = await import('vitest');
    const debugEnv = {
      DATA_SOURCE_COMPOSITION: 'adapters',
      ...ALL_MOCK,
      SOURCE_FIRMS_MODE: 'LIVE',
      BEACON_DEBUG_LIVE: '1',
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await assembleLiveSeeds(loadConfig(debugEnv), debugEnv, clock, newId)).not.toBeNull();
      const printed = err.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).not.toContain('registry build failed');
      expect(printed).not.toContain('falling back to offline seed');
    } finally {
      err.mockRestore();
      out.mockRestore();
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
    expect((live!.coreSeed.sources['us-ca'] ?? []).some((s) => s.sourceId === 'glofas')).toBe(
      false,
    );
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
    const cited = (input: typeof ca, id: string): boolean =>
      input.provenance.some((p) => p.sourceId === id);
    // CA: every source it enables and consumes is cited (weather from open-meteo, cameras from caltrans-cctv…).
    for (const id of [
      'firms',
      'nifc',
      'open-meteo',
      'osm-overpass',
      'opencellid',
      'nfhl',
      'eagle-i',
      'caltrans-cctv',
      'alertwildfire',
    ]) {
      expect(cited(ca, id), `us-ca must cite '${id}'`).toBe(true);
    }
    expect((ca.cameras ?? []).length).toBeGreaterThan(0);
    // RO: its own sources serve (EU flood + global cells + RO cameras); the seeded layer badges stay honest.
    for (const id of ['glofas', 'effis', 'open-meteo', 'osm-overpass', 'opencellid', 'cnadnr-ro']) {
      expect(cited(ro, id), `ro must cite '${id}'`).toBe(true);
    }
    expect(ro.layerSources).toMatchObject({
      flood: 'glofas',
      cell: 'opencellid',
      cameras: 'cnadnr-ro',
    });
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

  it("(a) a region override changes that region's adapter mode; (c) another region is unaffected", () => {
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
    const byRegion = buildRegionRegistries(
      regions,
      build({ ...ALL_MOCK, SOURCE_GLOFAS_MODE: 'CACHED' }),
    );
    expect(byRegion!.get('ro')!.get('glofas')!.mode).toBe('CACHED');
  });

  it('(d) a LIVE-without-key row a region DID enable is excluded from that region; the region still builds', () => {
    // Used to expect null here ("fails open when any region's registry fails to build"). Since 2026-09-12
    // a factory CONFIG Err excludes the row instead of failing the region — the same outcome (f) below
    // already guaranteed for a row the region did NOT enable, now extended to one it did.
    const regions = fakeRegions([{ configId: 'ro', overrides: {}, enabled: ['firms', 'glofas'] }]);
    const env = { ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' } as Record<string, string>;
    const byRegion = buildRegionRegistries(regions, (region) =>
      buildAdapterRegistry({
        cache: makeInMemoryCache(),
        env,
        sourceModeOverrides: region.sourceModeOverrides,
        enabledAdapters: region.region.enabledAdapters,
        ...fixed,
        onExclude: () => undefined, // the exclusion report is pinned in adapter-registry.test.ts; keep this test's output clean
      }),
    );
    expect(byRegion).not.toBeNull();
    expect(byRegion!.get('ro')!.has('firms')).toBe(false);
    expect(byRegion!.get('ro')!.has('glofas')).toBe(true);
  });

  // B1.3 (F-05): the allowlist is threaded per region, so each region gets ONLY the sources it enables…
  it("(e) each region's registry holds ONLY that region's enabled_adapters", () => {
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
    const byRegion = buildRegionRegistries(
      regions,
      build({ ...ALL_MOCK, SOURCE_FIRMS_MODE: 'LIVE' }),
    );
    expect(byRegion).not.toBeNull();
    expect(byRegion!.get('ro')!.has('firms')).toBe(false);
  });
});

// ── ADR-043: the live-only picture (2026-09-14) ───────────────────────────────────────────────────────
//
// The owner: "only the initial demo mock data is on the live map — this must be eliminated, and only current
// live reportings be shown." Under the adapters posture the picture is now live-only by default: no seeded
// incident, no seeded layer, and a MOCK answer is cited but never drawn.
describe('the live-only picture (LIVE_PICTURE=auto under the adapters posture)', () => {
  const liveOnly = { ...ALL_MOCK, LIVE_PICTURE: 'auto' };

  it('with every source MOCK, serves NO incident and NO seeded layer — and says which sources it asked', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...liveOnly };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live).not.toBeNull();
    expect(live!.coreSeed.incidents).toEqual([]); // the demo fire and flood are gone
    // The sources projection still lists what was consulted, mode-labelled, so /status is honest.
    expect((live!.coreSeed.sources['us-ca'] ?? []).length).toBeGreaterThan(0);
    expect((live!.coreSeed.sources['us-ca'] ?? []).every((s) => s.mode === 'MOCK')).toBe(true);
    const ca = live!.mapSeed['us-ca']!;
    expect(ca.hazards).toEqual([]);
    expect(ca.infrastructure).toEqual([]);
    expect(ca.route).toBeUndefined();
    expect(ca.cameras ?? []).toEqual([]);
    // Shelters come from the agency registry (config/shelters.json), the same rows the database seeds.
    expect(ca.shelters.length).toBeGreaterThan(0);
    expect(ca.shelters.map((s) => String(s.id))).not.toContain('ca-shelter-1'); // not the hand-seeded pin
    // A region the registry lists no shelters for has none — nothing is invented.
    expect(live!.mapSeed['es']!.shelters).toEqual([]);
  });

  it('LIVE_PICTURE=hybrid keeps the seeded picture by name', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, LIVE_PICTURE: 'hybrid' };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    expect(live!.coreSeed.incidents.map((i) => String(i.id))).toContain('us-ca-wildfire-demo');
  });

  it('the refresh doorbell rings for every map region, incidents or not', async () => {
    const rawEnv = { DATA_SOURCE_COMPOSITION: 'adapters', ...liveOnly };
    const live = await assembleLiveSeeds(loadConfig(rawEnv), rawEnv, clock, newId);
    const published: string[] = [];
    const deps = {
      clock,
      features: {
        eventBus: {
          publish: async (topic: string) => {
            published.push(topic);
            return { ok: true as const, value: undefined };
          },
        },
      },
    } as unknown as Parameters<typeof announceRefresh>[0];
    await announceRefresh(deps, live!);
    for (const region of Object.keys(live!.mapSeed)) {
      expect(published.some((t) => t.includes(region))).toBe(true);
    }
  });
});

// ── ADR-044: the feature overlay of the live-only picture ────────────────────────────────────────────
describe('liveOverlay — live threshold specs, footprints and regions for the discovered incidents', () => {
  const NOW_ISO = '2026-09-14T10:00:00Z';
  const at = (): string => NOW_ISO;
  const ca = DEFAULT_SEED.incidents.find((i) => String(i.regionId) === 'us-ca')!;
  const hotspot = (id: string, lon: number, lat: number) => ({
    id: asId<HazardGeometryId>(id),
    incidentId: asId<IncidentId>('firms-unassigned'),
    sourceId: asId<SourceId>('sr-1'),
    kind: 'HOTSPOT' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] as const },
    observedAt: NOW_ISO,
  });
  const discovered = {
    ...ca,
    id: asId<IncidentId>('discovered:us-ca:WILDFIRE:-487:158'),
    headline: 'Wildfire — 2 hotspots near 39.70°N 121.60°W',
    provenance: [{ sourceId: 'firms', mode: 'LIVE' as const, fetchedAt: NOW_ISO }],
    derivation: {
      ...ca.derivation,
      hazards: [hotspot('h1', -121.6, 39.7), hotspot('h2', -121.61, 39.71)],
    },
  };
  const coreSeed = { ...DEFAULT_SEED, incidents: [discovered] };
  const nodeNear = makeInfrastructureNode({
    id: asId<InfrastructureNodeId>('n-near'),
    type: 'HOSPITAL',
    geom: { type: 'Point', coordinates: [-121.605, 39.704] },
  });

  it('proposes a HAZARD_BUFFER draft for a discovered fire whose hotspots reach a lifeline node', () => {
    resetLiveRuleState();
    const mapSeed = {
      ...DEFAULT_MAP_SEED,
      'us-ca': { ...DEFAULT_MAP_SEED['us-ca']!, infrastructure: [nodeNear] },
    };
    const overlay = liveOverlay(coreSeed, mapSeed, at);
    const spec = overlay.thresholds.find((t) => String(t.incidentId) === String(discovered.id));
    expect(spec?.rule.target).toBe('HAZARD_BUFFER');
    expect(spec?.reading.hazardWithinBuffer).toBe(true);
    expect(
      deriveDraftAlertProposals({ specs: overlay.thresholds, now: Date.parse(NOW_ISO) }),
    ).toHaveLength(1);
    // The rule catalogue is the configured region rules (three today), the footprint and region are set.
    expect(overlay.thresholdRules.length).toBeGreaterThanOrEqual(3);
    expect(overlay.hazards.get(String(discovered.id))?.type).toBe('Polygon');
    expect(overlay.incidentRegions.get(String(discovered.id))).toBe('us-ca');
  });

  it('carries the evaluator’s state across cycles — the same episode does not draft twice', () => {
    resetLiveRuleState();
    const mapSeed = {
      ...DEFAULT_MAP_SEED,
      'us-ca': { ...DEFAULT_MAP_SEED['us-ca']!, infrastructure: [nodeNear] },
    };
    const first = liveOverlay(coreSeed, mapSeed, at);
    expect(
      deriveDraftAlertProposals({ specs: first.thresholds, now: Date.parse(NOW_ISO) }),
    ).toHaveLength(1);
    const second = liveOverlay(coreSeed, mapSeed, () => '2026-09-14T10:05:00Z');
    expect(second.thresholds[0]?.previous).toBeDefined();
    expect(
      deriveDraftAlertProposals({
        specs: second.thresholds,
        now: Date.parse('2026-09-14T10:05:00Z'),
      }),
    ).toHaveLength(0);
  });

  it('assembleLiveSeeds carries an overlay under BOTH pictures; only hybrid keeps the seeded specs', async () => {
    const liveOnly = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, LIVE_PICTURE: 'auto' };
    const live = await assembleLiveSeeds(loadConfig(liveOnly), liveOnly, clock, newId);
    expect(live?.overlay).toBeDefined();
    expect(live?.overlay?.keepSeeded).toBe(false);
    expect(live?.overlay?.thresholdRules.length).toBeGreaterThanOrEqual(3);
    const hybrid = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK };
    const kept = await assembleLiveSeeds(loadConfig(hybrid), hybrid, clock, newId);
    expect(kept?.overlay?.keepSeeded).toBe(true);
    expect(kept?.overlay?.thresholdRules.length).toBeGreaterThanOrEqual(3);
  });

  it('evaluates the rules a source supplies (the table under Postgres) and lists exactly those', async () => {
    resetLiveRuleState();
    const tableRule = makeThresholdRule({
      id: asId<ThresholdRuleId>('operator-edited-rule'),
      scope: asId<RegionId>('us-ca'),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '500m',
    });
    const mapSeed = {
      ...DEFAULT_MAP_SEED,
      'us-ca': { ...DEFAULT_MAP_SEED['us-ca']!, infrastructure: [nodeNear] },
    };
    const overlay = liveOverlay(coreSeed, mapSeed, at, { rules: [tableRule] });
    expect(overlay.thresholdRules).toEqual([tableRule]);
    expect(overlay.thresholds.map((t) => String(t.rule.id))).toEqual(['operator-edited-rule']);
    // The wire-up: assembleLiveSeeds hands the source's rules to the overlay.
    const env = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, LIVE_PICTURE: 'auto' };
    const live = await assembleLiveSeeds(
      loadConfig(env),
      env,
      clock,
      newId,
      undefined,
      undefined,
      () => Promise.resolve([tableRule]),
    );
    expect(live?.overlay?.thresholdRules).toEqual([tableRule]);
  });

  it('a source that fails (table unreadable) falls back to the configuration rules — never no rules', async () => {
    const env = { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK, LIVE_PICTURE: 'auto' };
    const live = await assembleLiveSeeds(
      loadConfig(env),
      env,
      clock,
      newId,
      undefined,
      undefined,
      () => Promise.reject(new Error('connection refused')),
    );
    expect(live?.overlay?.thresholdRules.length).toBeGreaterThanOrEqual(3);
  });
});
