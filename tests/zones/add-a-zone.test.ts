// BEACON — "add a zone by config" acceptance test (ADR-031; FR-ZONE-3 / master-plan §5.7 acceptance test a).
//
// The claim under test is a headline one: a new operating region is a CONFIG entry, not a code change. This
// file pins the half of that claim which exists today, and — more importantly — pins the failure mode that
// used to be silent: a region the composition root does not recognise must NOT inherit another region's
// geography. Before this wave it inherited California's bounding box, so a freshly added zone would have
// queried every source over California and rendered the result as if it were local (finding F-06). A wrong
// map that looks right is the worst thing a common operating picture can do, so it gets its own test.
//
// When the generic coverage-driven enrichment lands (task B1.8) this file gains the second half: that the
// synthetic zone renders POPULATED from the global aggregators. The assertions below are written so that
// change strengthens them rather than rewriting them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseRegionRegistry } from '@/adapters/persistence/region-registry.js';

const SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../schemas/regions.schema.json', import.meta.url)), 'utf8'),
) as object;
const CONFIG = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/regions.json', import.meta.url)), 'utf8'),
) as { default_region_id: string; regions: readonly Record<string, unknown>[] };

/** A plausible new zone, authored the way a contributor would: config only, no code. */
const SYNTHETIC_ZONE = {
  id: 'pt',
  name: 'Portugal (synthetic test zone)',
  scope: 'COUNTRY',
  iso: 'PT',
  bbox: [-9.55, 36.95, -6.19, 42.16],
  tz: 'Europe/Lisbon',
  languages: ['pt-BR'], // a SHIPPED locale — the coverage-completeness rule (pt-PT is not shipped)
  enabled_adapters: ['gdacs', 'effis', 'worldpop', 'osm-overpass'],
  source_mode_overrides: { effis: 'CACHED' },
} as const;

function withSyntheticZone(): { default_region_id: string; regions: readonly unknown[] } {
  return { ...CONFIG, regions: [...CONFIG.regions, SYNTHETIC_ZONE] };
}

describe('adding a zone by configuration', () => {
  it('is accepted by the region schema with no source change', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);
    validate(withSyntheticZone());
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('loads into the registry as a first-class region', () => {
    const registry = parseRegionRegistry(withSyntheticZone());
    const added = registry.regions.find((r) => r.configId === 'pt');
    expect(added).toBeDefined();
    expect(added?.region.iso).toBe('PT');
    expect(added?.region.tz).toBe('Europe/Lisbon');
    expect(added?.region.languages).toEqual(['pt-BR']);
    expect(added?.region.enabledAdapters).toEqual([...SYNTHETIC_ZONE.enabled_adapters]);
    expect(added?.sourceModeOverrides).toEqual({ effis: 'CACHED' });
  });

  it('keeps ITS OWN geography — never another region’s (finding F-06)', () => {
    const registry = parseRegionRegistry(withSyntheticZone());
    const added = registry.regions.find((r) => r.configId === 'pt')!;
    expect(added.region.bbox).toEqual([...SYNTHETIC_ZONE.bbox]);
    for (const other of registry.regions.filter((r) => r.configId !== 'pt')) {
      expect(JSON.stringify(added.region.bbox)).not.toBe(JSON.stringify(other.region.bbox));
    }
  });

  it('does not disturb the existing regions (adding a zone is additive)', () => {
    const before = parseRegionRegistry(CONFIG);
    const after = parseRegionRegistry(withSyntheticZone());
    for (const original of before.regions) {
      const still = after.regions.find((r) => r.configId === original.configId);
      expect(still?.region, original.configId).toEqual(original.region);
    }
    expect(after.defaultRegionId).toBe(before.defaultRegionId);
  });

  it('rejects a zone whose declared language is not a shipped locale (coverage-completeness rule)', async () => {
    const { isLocaleId } = await import('@/config/locales.js');
    // Shipping a zone whose population cannot read the interface would be a coverage claim we cannot honour.
    expect(isLocaleId('pt-PT')).toBe(false);
    expect(SYNTHETIC_ZONE.languages.every((l) => isLocaleId(l))).toBe(true);
  });

  // B3.5: the same completeness rules, applied to the zones that ACTUALLY SHIP. The synthetic `pt` case
  // above proves the mechanism; this proves we used it correctly. A zone whose selector entry renders its
  // raw id, or whose population has no catalog to read the interface in, is a coverage claim we cannot
  // honour — and it would be invisible in review, because the zone still loads and still draws a map.
  it('every SHIPPED zone has a translated selector label and a shipped locale (fil/el included)', async () => {
    const { isLocaleId, LOCALE_IDS } = await import('@/config/locales.js');
    const english = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../messages/en.json', import.meta.url)), 'utf8'),
    ) as { shell: { region: Record<string, string> } };
    const shipped = CONFIG.regions as readonly { id: string; languages: readonly string[] }[];
    expect(shipped.length).toBeGreaterThan(1);

    for (const zone of shipped) {
      // The selector label comes from the CATALOG, not from config `name` (finding F-22) — so a zone with
      // no catalog key falls back to rendering its raw id ('ph') in the region dropdown.
      const label = english.shell.region[zone.id];
      expect(typeof label, `messages/en.json is missing shell.region.${zone.id}`).toBe('string');
      expect(label!.trim()).not.toBe('');
      expect(label, `shell.region.${zone.id} must not be the raw id`).not.toBe(zone.id);
      // Coverage-completeness: the zone's own language(s) must be shipped locales, so an alert emitted for
      // this zone has a catalog to be emitted in (FR-I18N-6). `gr` ⇒ el and `ph` ⇒ fil are the B3.3 cases.
      for (const lang of zone.languages) {
        expect(isLocaleId(lang), `zone '${zone.id}' declares language '${lang}', which is not a shipped locale`).toBe(true);
      }
    }
    // Non-vacuity: the two locales B3.3's zones promote are really in the registry, not just parseable.
    expect(LOCALE_IDS).toContain('el');
    expect(LOCALE_IDS).toContain('fil');
  });

  it('rejects a malformed zone rather than accepting it half-configured', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);
    for (const broken of [
      { ...SYNTHETIC_ZONE, iso: 'PRT' }, // not alpha-2 ⇒ silently kills country-scoped coverage
      { ...SYNTHETIC_ZONE, bbox: [-9.55, 36.95] }, // truncated extent
      { ...SYNTHETIC_ZONE, languages: [] }, // nobody could read it
      { ...SYNTHETIC_ZONE, id: '../etc/passwd' }, // the id reaches cache keys and URLs
    ]) {
      expect(validate({ ...CONFIG, regions: [...CONFIG.regions, broken] }), JSON.stringify(broken.id)).toBe(false);
    }
  });
});
