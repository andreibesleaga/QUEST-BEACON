// BEACON — region-registry schema + geography-safety tests (ADR-031; FR-ZONE-1/2/7, findings F-04…F-06).
//
// The load-bearing test here is the last one. Before this wave, an unconfigured region silently inherited
// CALIFORNIA's bounding box, so a third region would have queried every source over California and rendered
// the result as if it were local — a wrong map that looks right, which is the worst failure mode a common
// operating picture has. There is now no geographic fallback at all, and this pins that.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadRegionRegistry, parseRegionRegistry } from './region-registry.js';

const CONFIG = fileURLToPath(new URL('../../../config/regions.json', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../schemas/regions.schema.json', import.meta.url));

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
  default_region_id: string;
  regions: { id: string }[];
};

describe('config/regions.json ↔ schemas/regions.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
    );
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('points default_region_id at a region that actually exists', () => {
    expect(raw.regions.map((r) => r.id)).toContain(raw.default_region_id);
  });

  it('requires iso, tz and languages of every config-authored region', () => {
    // These three used to be absent, which is what forced a hardcoded ISO map into the composition root.
    for (const region of raw.regions as unknown as Record<string, unknown>[]) {
      expect(region['iso'], `${String(region['id'])} iso`).toMatch(/^[A-Z]{2}$/);
      expect(String(region['tz']).length, `${String(region['id'])} tz`).toBeGreaterThan(2);
      expect(
        Array.isArray(region['languages']) && (region['languages'] as unknown[]).length > 0,
      ).toBe(true);
    }
  });

  it('rejects an EMPTY enabled_adapters — "consult nothing" must not look like an accident (F-54)', () => {
    // Since B1.3 an empty allowlist means ZERO adapters (buildAdapterRegistry never widens it to "all"), and
    // since B1.8 the allowlist IS the consulted set in precedence order. So an empty array would load a
    // region that renders and labels a picture no source was ever asked about — indistinguishable from a
    // config typo. `minItems: 1` makes that state unrepresentable: an operator who wants a region gone
    // deletes the region. The positive control below proves the constraint is real, not merely declared.
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
    );
    const emptied = {
      ...raw,
      regions: (raw.regions as unknown as Record<string, unknown>[]).map((r, i) =>
        i === 0 ? { ...r, enabled_adapters: [] } : r,
      ),
    };
    expect(validate(emptied)).toBe(false);
    expect(
      (validate.errors ?? []).some(
        (e) => e.instancePath.endsWith('/enabled_adapters') && e.keyword === 'minItems',
      ),
      JSON.stringify(validate.errors),
    ).toBe(true);
    // …and the SHIPPED config still validates (the constraint bites the bad case only).
    expect(validate(raw)).toBe(true);
  });

  it('no longer carries the misleading per-region `units` switch (finding F-10)', () => {
    // It claimed an imperial/metric choice nothing implemented; BEACON shows SI everywhere, always labelled.
    for (const region of raw.regions as unknown as Record<string, unknown>[]) {
      expect(region['units']).toBeUndefined();
    }
  });
});

describe('loaded regions carry their own geography and metadata', () => {
  it('exposes iso, tz and languages on the domain entity', () => {
    const res = loadRegionRegistry();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const loaded of res.value.regions) {
      expect(loaded.region.iso, loaded.configId).toMatch(/^[A-Z]{2}$/);
      expect(loaded.region.tz, loaded.configId).toBeDefined();
      expect(loaded.region.languages?.length ?? 0, loaded.configId).toBeGreaterThan(0);
    }
  });

  it("every region's language is a shipped locale (coverage-completeness rule)", async () => {
    const { isLocaleId } = await import('@/config/locales.js');
    const res = loadRegionRegistry();
    if (!res.ok) return;
    for (const loaded of res.value.regions) {
      for (const language of loaded.region.languages ?? []) {
        expect(
          isLocaleId(language),
          `${loaded.configId} speaks ${language}, which is not a shipped locale`,
        ).toBe(true);
      }
    }
  });

  it('rejects an ISO code that is not alpha-2 (a typo must not silently disable coverage matching)', () => {
    expect(() =>
      parseRegionRegistry({
        default_region_id: 'x',
        regions: [
          {
            id: 'x',
            name: 'X',
            scope: 'COUNTRY',
            iso: 'ROU',
            bbox: [0, 0, 1, 1],
            tz: 'UTC',
            languages: ['en'],
          },
        ],
      }),
    ).toThrow();
  });

  it('gives two different regions two different bounding boxes (no shared fallback geography)', () => {
    const res = loadRegionRegistry();
    if (!res.ok) return;
    const boxes = res.value.regions.map((r) => JSON.stringify(r.region.bbox));
    expect(new Set(boxes).size).toBe(boxes.length);
  });
});
