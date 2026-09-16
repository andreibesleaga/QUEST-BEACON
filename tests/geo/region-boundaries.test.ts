// BEACON — the shipped region boundaries do what regions.json says they do (ADR-042, 2026-09-14).
//
// The owner's report: "when selecting Romania the incidents are shown in other countries". Romania's
// bbox is a rectangle that reaches Belgrade, Sofia and Chișinău; FIRMS hotspots in Serbia were clustered
// into a "Romanian" wildfire. These tests pin the outline against real places, and pin that every
// configured region loads its outline and that the outline sits inside the fetch window.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRegionRegistry } from '@/adapters/persistence/region-registry.js';
import { clipToRegion, inBoundary } from '@/application/shared/region-clip.js';
import type { Position } from '@/domain/value-objects/geo.js';

const registry = loadRegionRegistry();
if (!registry.ok) throw registry.error;
const region = (id: string) => registry.value.regions.find((r) => r.configId === id)!.region;

const PLACES: Record<string, readonly [name: string, pos: Position, inside: string][]> = {
  ro: [
    ['Bucharest', [26.1025, 44.4268], 'yes'],
    ['Galați', [28.0341, 45.4353], 'yes'],
    ['Timișoara', [21.2087, 45.7489], 'yes'],
    ['Belgrade (Serbia)', [20.4573, 44.8176], 'no'],
    ['Sofia (Bulgaria)', [23.3219, 42.6977], 'no'],
    ['Chișinău (Moldova)', [28.8575, 47.0105], 'no'],
    ['Budapest (Hungary)', [19.0402, 47.4979], 'no'],
  ],
  es: [
    ['Madrid', [-3.7038, 40.4168], 'yes'],
    ['Palma', [2.6502, 39.5696], 'yes'],
    ['Lisbon (Portugal)', [-9.1393, 38.7223], 'no'],
    ['Perpignan (France)', [2.8954, 42.6887], 'no'],
  ],
  gr: [
    ['Athens', [23.7275, 37.9838], 'yes'],
    ['Heraklion', [25.1442, 35.3387], 'yes'],
    ['Istanbul (Türkiye)', [28.9784, 41.0082], 'no'],
    ['Tirana (Albania)', [19.8187, 41.3275], 'no'],
  ],
  ph: [
    ['Manila', [120.9842, 14.5995], 'yes'],
    ['Davao', [125.6, 7.07], 'yes'],
    ['Kota Kinabalu (Malaysia)', [116.0753, 5.9804], 'no'],
  ],
  'us-ca': [
    ['Sacramento', [-121.4944, 38.5816], 'yes'],
    ['Los Angeles', [-118.2437, 34.0522], 'yes'],
    ['Reno (Nevada)', [-119.8138, 39.5296], 'no'],
    ['Tijuana (Mexico)', [-117.0382, 32.5149], 'no'],
    ['Portland (Oregon)', [-122.6765, 45.5231], 'no'],
  ],
};

describe('every configured region ships an outline that lies inside its fetch window', () => {
  for (const loaded of registry.value.regions) {
    it(`${loaded.configId} has a Polygon/MultiPolygon boundary within its bbox`, () => {
      const { bbox, boundary } = loaded.region;
      expect(boundary).toBeDefined();
      const rings =
        boundary!.type === 'Polygon'
          ? boundary!.coordinates
          : boundary!.type === 'MultiPolygon'
            ? boundary!.coordinates.flat()
            : [];
      expect(rings.length).toBeGreaterThan(0);
      for (const ring of rings)
        for (const [lon, lat] of ring) {
          expect(lon).toBeGreaterThanOrEqual(bbox[0] - 0.05);
          expect(lon).toBeLessThanOrEqual(bbox[2] + 0.05);
          expect(lat).toBeGreaterThanOrEqual(bbox[1] - 0.05);
          expect(lat).toBeLessThanOrEqual(bbox[3] + 0.05);
        }
    });
  }
});

describe('the outline separates the region from its neighbours inside the same rectangle', () => {
  for (const [id, places] of Object.entries(PLACES)) {
    for (const [name, pos, inside] of places) {
      it(`${id}: ${name} is ${inside === 'yes' ? 'inside' : 'outside'}`, () => {
        expect(inBoundary(pos, region(id).boundary!)).toBe(inside === 'yes');
      });
    }
  }
});

describe('the coast is not a wall', () => {
  it('a webcam on the Golden Gate Bridge (over water, inside the strait) is California’s', () => {
    const ca = region('us-ca');
    const bridge: Position = [-122.4783, 37.8199];
    expect(inBoundary(bridge, ca.boundary!)).toBe(false); // the land polygon stops at the shore…
    const webcam = { id: 'gg', position: bridge };
    expect(clipToRegion([webcam], { bbox: ca.bbox, boundary: ca.boundary! }).kept).toEqual([
      webcam,
    ]); // …the clip does not
  });

  it('but a city 40 km over the border is still not inside', () => {
    const ro = region('ro');
    expect(
      clipToRegion([{ position: [20.4573, 44.8176] }], { bbox: ro.bbox, boundary: ro.boundary! })
        .kept,
    ).toEqual([]);
  });
});

describe('clipToRegion with a boundary', () => {
  it('drops a Serbian hotspot from Romania even though it is inside Romania’s bbox, and keeps Galați', () => {
    const ro = region('ro');
    const belgrade = { id: 'b', geometry: { type: 'Point', coordinates: [20.4573, 44.8176] } };
    const galati = { id: 'g', geometry: { type: 'Point', coordinates: [28.0341, 45.4353] } };
    expect(clipToRegion([belgrade, galati], ro.bbox).kept).toEqual([belgrade, galati]); // bbox rule
    expect(
      clipToRegion([belgrade, galati], { bbox: ro.bbox, boundary: ro.boundary! }).kept,
    ).toEqual([galati]);
  });

  it('keeps a region-wide reading whose box is the region’s own bbox (its centre is inside the border)', () => {
    const ro = region('ro');
    const weather = { at: 'now', bbox: ro.bbox, windSpeedMs: 3 };
    expect(clipToRegion([weather], { bbox: ro.bbox, boundary: ro.boundary! }).kept).toEqual([
      weather,
    ]);
  });

  it('keeps an area that encloses the whole region, drops one recorded in another country', () => {
    const ro = region('ro');
    const continental = { area: [0, 30, 40, 60] };
    const butte = { area: [-121.9, 39.4, -121.35, 39.85] };
    const out = clipToRegion([continental, butte], { bbox: ro.bbox, boundary: ro.boundary! });
    expect(out.kept).toEqual([continental]);
  });
});

describe('the seeded resource roster is inside its own region', () => {
  const data = JSON.parse(
    readFileSync(resolve(process.cwd(), 'config/reference-data.json'), 'utf8'),
  ) as {
    resources: readonly { domain_id: string; region_id: string; lon?: number; lat?: number }[];
  };
  for (const r of data.resources) {
    if (r.lon === undefined || r.lat === undefined) continue;
    it(`${r.domain_id} (${r.region_id})`, () => {
      const region = registry.value.regions.find((x) => x.configId === r.region_id)!.region;
      expect(inBoundary([r.lon!, r.lat!], region.boundary!, 0.03)).toBe(true);
    });
  }
});
