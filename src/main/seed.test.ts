// BEACON — DEFAULT_SEED region-view tests (B1.2 / finding F-01). The offline seed is what `GET /regions`
// serves in the default (air-gapped) profile, so every geography/locale value it projects must come from
// `config/regions.json` and from nowhere else — a second, hand-typed copy is what let an unconfigured
// region inherit California's extent (finding F-06). Deterministic: pure data, no clock, no network.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import { DEFAULT_SEED, seededRegion } from './seed.js';

interface RawRegion {
  readonly id: string;
  readonly name: string;
  readonly iso: string;
  readonly tz: string;
  readonly languages: readonly string[];
  readonly bbox: readonly number[];
}

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/regions.json', import.meta.url)), 'utf8'),
) as { readonly regions: readonly RawRegion[] };

describe('DEFAULT_SEED regions (the offline GET /regions payload)', () => {
  it('projects iso/tz/languages/bbox straight from config/regions.json for every seeded region', () => {
    expect(DEFAULT_SEED.regions.length).toBeGreaterThan(0);
    for (const seeded of DEFAULT_SEED.regions) {
      const raw = config.regions.find((r) => r.id === String(seeded.id));
      expect(raw, `${String(seeded.id)} must exist in config/regions.json`).toBeDefined();
      expect(seeded.iso).toBe(raw?.iso);
      expect(seeded.tz).toBe(raw?.tz);
      expect(seeded.languages).toEqual(raw?.languages);
      expect(seeded.bbox).toEqual(raw?.bbox);
    }
  });

  it('keeps the demo display labels (config `name` is operator-facing and must NOT render — ADR-031)', () => {
    expect(DEFAULT_SEED.regions.map((r) => r.name)).toEqual([
      'California (US)',
      'Romania (EU)',
      'Spain (EU)',
      'Greece (EU)',
      'Philippines',
    ]);
    // …and none of them is the config's operator-facing `name` (which carries the "(Flagship)"/"demo-grade"
    // qualifiers). Rendering those would change four visual baselines and leak operational posture (F-22).
    const operatorNames = new Set(config.regions.map((r) => r.name));
    for (const seeded of DEFAULT_SEED.regions) {
      expect(operatorNames.has(seeded.name), `'${seeded.name}' is the config name, not the demo label`).toBe(false);
    }
  });

  it('seeds EVERY configured region, in config order (a shipped zone with no seed renders nothing offline)', () => {
    expect(DEFAULT_SEED.regions.map((r) => String(r.id))).toEqual(config.regions.map((r) => r.id));
  });

  it('gives each region its OWN extent — never the flagship\'s (finding F-06)', () => {
    const boxes = DEFAULT_SEED.regions.map((r) => JSON.stringify(r.bbox));
    expect(new Set(boxes).size).toBe(boxes.length);
  });
});

describe('seededRegion — a region the config does not know', () => {
  it('returns id + name ONLY: no borrowed bbox, no defaulted timezone or language (F-06)', () => {
    const view = seededRegion(asId<RegionId>('zz-nowhere'), 'Nowhere');
    expect(view).toEqual({ id: 'zz-nowhere', name: 'Nowhere' });
    expect(Object.keys(view)).toEqual(['id', 'name']);
  });
});
