// BEACON — region registry loader tests (E3·T-129; ADR-011). Asserts the real config/regions.json loads
// into the 5 shipped zones — the CA LIVE flagship + Romania CACHED (per-source mode overrides), plus the
// three DEMO-GRADE zones added by B3.3 (es/gr/ph) as CONFIG ONLY, with no application code.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { loadManifest } from '@/main/adapter-registry.js';
import type { RegionRegistry } from './region-registry';
import { loadRegionRegistry, parseRegionRegistry, regionAlertLocales } from './region-registry';

describe('loadRegionRegistry (real config/regions.json)', () => {
  it('loads CA (default) + Romania with the RO CACHED overrides', () => {
    const result = loadRegionRegistry();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const reg = result.value;
    expect(reg.defaultRegionId).toBe('us-ca');
    expect(reg.regions.map((r) => r.configId)).toEqual(['us-ca', 'ro', 'es', 'gr', 'ph']);

    const ca = reg.regions.find((r) => r.configId === 'us-ca');
    const ro = reg.regions.find((r) => r.configId === 'ro');
    expect(ca?.region.scope).toBe('STATE');
    expect(ca?.region.name).toBe('California (Flagship)');
    expect(ca?.sourceModeOverrides).toEqual({}); // CA is fully LIVE
    expect(ca?.region.bbox).toEqual([-124.48, 32.53, -114.13, 42.01]);

    expect(ro?.region.scope).toBe('COUNTRY');
    // Romania demonstrates the CACHED portability path (D-25).
    expect(ro?.sourceModeOverrides['glofas']).toBe('CACHED');
    expect(ro?.sourceModeOverrides['meteoalarm-ro']).toBe('CACHED');
    expect(ro?.region.enabledAdapters).toContain('meteoalarm-ro');
  });

  // B3.3: the three zones added as config only. Each carries its OWN geography/timezone/languages (never
  // another region's — finding F-06) and its own national alert source. The bboxes are asserted LITERALLY
  // because they are the values a source query is bounded by: a silently edited extent queries the wrong
  // part of the planet and renders the answer as if it were local.
  const B3_ZONES = [
    { id: 'es', iso: 'ES', tz: 'Europe/Madrid', languages: ['es'], bbox: [-9.31, 35.99, 4.33, 43.8], national: 'meteoalarm-es' },
    { id: 'gr', iso: 'GR', tz: 'Europe/Athens', languages: ['el'], bbox: [19.36, 34.79, 29.65, 41.76], national: 'meteoalarm-gr' },
    // `ph` carries two languages, the zone's OWN first, then English (FR-I18N-6).
    { id: 'ph', iso: 'PH', tz: 'Asia/Manila', languages: ['fil', 'en'], bbox: [116.87, 4.4, 126.62, 21.14], national: 'wmo-swic' },
  ] as const;

  it.each(B3_ZONES)('loads the B3.3 zone $id with its own geography, locale and national alert source', (zone) => {
    const result = loadRegionRegistry();
    if (!isOk(result)) throw new Error('region registry failed to load');
    const loaded = result.value.regions.find((r) => r.configId === zone.id);
    expect(loaded, `zone '${zone.id}' is missing from config/regions.json`).toBeDefined();
    expect(loaded?.region.scope).toBe('COUNTRY');
    expect(loaded?.region.iso).toBe(zone.iso);
    expect(loaded?.region.tz).toBe(zone.tz);
    expect(loaded?.region.languages).toEqual([...zone.languages]);
    expect(loaded?.region.bbox).toEqual([...zone.bbox]);
    expect(loaded?.region.enabledAdapters).toContain(zone.national);
  });

  // No US-only row, and no OTHER zone's national row, reached any of the three. Both would be dead config
  // (the coverage gate returns NOT_COVERED), so listing them would only inflate the zone's source list —
  // the dishonesty class F-63 corrected once already.
  const FOREIGN_TO_B3 = [
    'nwps', 'nfhl', 'eagle-i', 'census', 'nifc', 'nws', 'usgs-water',
    'caltrans-cctv', 'alertwildfire', 'dot511', 'meteoalarm-ro', 'cnadnr-ro',
    'airnow', // S3: North-America-only AirQuality (BBOX coverage) — would be dead config on es/gr/ph
  ];

  it.each(B3_ZONES)('zone $id enables no US-only row and no other zone’s national source', (zone) => {
    const result = loadRegionRegistry();
    if (!isOk(result)) throw new Error('region registry failed to load');
    const enabled = new Set(result.value.regions.find((r) => r.configId === zone.id)?.region.enabledAdapters ?? []);
    expect(enabled.size).toBeGreaterThan(0); // non-vacuity: an empty allowlist would pass this trivially
    const leaked = FOREIGN_TO_B3.filter((id) => enabled.has(id));
    expect(leaked, `zone '${zone.id}' enables rows that do not cover it: ${leaked.join(', ')}`).toEqual([]);
  });
});

describe('parseRegionRegistry', () => {
  it('maps raw config entries to domain Region entities', () => {
    const raw = {
      default_region_id: 'x',
      regions: [
        {
          id: 'x',
          name: 'Test',
          scope: 'COMMUNITY',
          bbox: [0, 0, 1, 1],
          enabled_adapters: ['a'],
          source_mode_overrides: { a: 'MOCK' },
        },
      ],
    };
    const reg = parseRegionRegistry(raw);
    expect(reg.regions[0]?.region.id).toBe('x');
    expect(reg.regions[0]?.sourceModeOverrides).toEqual({ a: 'MOCK' });
  });

  it('throws PARSE_ERROR on a malformed registry', () => {
    expect(() => parseRegionRegistry({ nope: true })).toThrow();
  });
});

// Drift guard (B2, EXTENDED by B1.6 / finding F-12): every id a region references in enabled_adapters +
// source_mode_overrides MUST be a real manifest id in config/adapters.json — a roadmap-only name
// (config/planned-sources.md) or a stale/renamed id would silently gate to nothing (enabled) or never resolve
// a factory (override). Now that enabled_adapters is ENFORCED as an allowlist (B1.3), a typo there is worse
// than dead config: it silently REMOVES a source from that region. This fails fast on drift.

/**
 * Every `<region>.<field>:<id>` reference that is NOT a real manifest id. One shared implementation so the
 * real-config guard and the typo positive-control below exercise the SAME check (a guard nobody has ever seen
 * fail is not a guard).
 */
function unknownAdapterRefs(registry: RegionRegistry, realIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const r of registry.regions) {
    for (const id of r.region.enabledAdapters) {
      if (!realIds.has(id)) out.push(`${r.configId}.enabled_adapters:${id}`);
    }
    for (const id of Object.keys(r.sourceModeOverrides)) {
      if (!realIds.has(id)) out.push(`${r.configId}.source_mode_overrides:${id}`);
    }
  }
  return out;
}

function manifestIds(): ReadonlySet<string> {
  const manifest = loadManifest();
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) throw new Error('adapter manifest failed to load');
  return new Set(manifest.value.adapters.map((a) => a.id));
}

function shippedRegions(): RegionRegistry {
  const reg = loadRegionRegistry();
  expect(isOk(reg)).toBe(true);
  if (!isOk(reg)) throw new Error('region registry failed to load');
  return reg.value;
}

describe('regions.json ↔ config/adapters.json id integrity', () => {
  it('every enabled_adapters + source_mode_overrides id exists in the adapter manifest', () => {
    expect(unknownAdapterRefs(shippedRegions(), manifestIds())).toEqual([]);
  });

  // Non-vacuity: the guard above passes trivially on an empty registry or on regions with empty allowlists,
  // so pin that neither is the case. This ALSO pins the allowlist semantics chosen in B1.3: an EMPTY
  // enabled_adapters means "consult NOTHING" (buildAdapterRegistry builds zero rows — it never silently
  // widens to the whole manifest), which is only a safe default because no SHIPPED region relies on it.
  it('is non-vacuous: every shipped region enables at least one adapter', () => {
    const regions = shippedRegions().regions;
    expect(regions.length).toBeGreaterThan(0);
    for (const r of regions) {
      expect(r.region.enabledAdapters.length, `region '${r.configId}' has an EMPTY allowlist`).toBeGreaterThan(0);
    }
  });

  // A mode override for a source the region does not enable is DEAD config now that the allowlist is
  // enforced: the row is never built, so the override can never take effect — exactly the class of silent
  // no-op F-05 was about.
  it('every source_mode_overrides id is also on that region’s enabled_adapters allowlist', () => {
    for (const r of shippedRegions().regions) {
      const allowed = new Set(r.region.enabledAdapters);
      for (const id of Object.keys(r.sourceModeOverrides)) {
        expect(allowed.has(id), `region '${r.configId}' overrides the mode of non-enabled adapter '${id}'`).toBe(true);
      }
    }
  });

  // Positive control (F-12): a typo'd adapter id MUST be caught. Without this, the guard could be silently
  // broken (e.g. comparing the wrong field) and still stay green forever on a correct config.
  it('DETECTS a typo’d adapter id in enabled_adapters and in source_mode_overrides', () => {
    const typo = parseRegionRegistry({
      default_region_id: 'us-ca',
      regions: [
        {
          id: 'us-ca',
          name: 'California',
          scope: 'STATE',
          iso: 'US',
          bbox: [-124.48, 32.53, -114.13, 42.01],
          tz: 'America/Los_Angeles',
          languages: ['en'],
          enabled_adapters: ['firms', 'firmz'], // 'firmz' is not a manifest id
          source_mode_overrides: { 'glofass': 'CACHED' }, // neither is 'glofass'
        },
      ],
    });
    expect(unknownAdapterRefs(typo, manifestIds())).toEqual([
      'us-ca.enabled_adapters:firmz',
      'us-ca.source_mode_overrides:glofass',
    ]);
  });
});

// B1.3 (F-05/F-14): a region's `languages` resolved into the ordered locale list an outbound alert must
// carry. The CAP emission path is the consumer (see regionAlertLocales' doc comment for the open wiring).
describe('regionAlertLocales (region languages → alert locales)', () => {
  it('puts the region’s own language first and ALWAYS appends English (FR-I18N-6)', () => {
    const regions = shippedRegions();
    expect(regionAlertLocales(regions, 'ro')).toEqual(['ro', 'en']);
    // An English-speaking region carries English exactly once (never duplicated).
    expect(regionAlertLocales(regions, 'us-ca')).toEqual(['en']);
  });

  it('an unconfigured region resolves to English only — never another region’s language', () => {
    expect(regionAlertLocales(shippedRegions(), 'no-such-region')).toEqual(['en']);
  });

  it('drops a configured language that is not a shipped locale (no <info> block without a catalog)', () => {
    const reg = parseRegionRegistry({
      default_region_id: 'x',
      regions: [{ id: 'x', name: 'X', scope: 'COUNTRY', bbox: [0, 0, 1, 1], enabled_adapters: ['firms'], languages: ['zz', 'ro'] }],
    });
    expect(regionAlertLocales(reg, 'x')).toEqual(['ro', 'en']);
  });
});
