// BEACON — deterministic geo-helper tests (E5). These are pure typed-code math (Art. XII); numbers must
// be reproducible. Covers distance, forward geodesic, geometry anchoring (all variants + the empty edge),
// polygon decomposition, and unit-clamping.
import { describe, it, expect } from 'vitest';
import type { Geometry } from '@/domain/value-objects/geo.js';
import {
  haversineMeters,
  destinationPoint,
  representativePoint,
  polygonsOf,
  clamp01,
} from './geo.js';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters([-121.5, 39.8], [-121.5, 39.8])).toBe(0);
  });

  it('measures ~111 km for one degree of latitude', () => {
    const d = haversineMeters([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('destinationPoint', () => {
  it('moves due east (bearing 90) increasing longitude, latitude ~unchanged', () => {
    const [lon, lat] = destinationPoint([0, 0], 111_195, 90);
    expect(lon).toBeCloseTo(1, 1);
    expect(lat).toBeCloseTo(0, 3);
  });

  it('moves due north (bearing 0) increasing latitude', () => {
    const [lon, lat] = destinationPoint([0, 0], 111_195, 0);
    expect(lat).toBeCloseTo(1, 1);
    expect(lon).toBeCloseTo(0, 6);
  });
});

describe('representativePoint', () => {
  it('returns a Point coordinate directly', () => {
    expect(representativePoint({ type: 'Point', coordinates: [1, 2] })).toEqual([1, 2]);
  });

  it('returns the first vertex of a LineString', () => {
    expect(
      representativePoint({
        type: 'LineString',
        coordinates: [
          [3, 4],
          [5, 6],
        ],
      }),
    ).toEqual([3, 4]);
  });

  it('returns the first vertex of a Polygon outer ring', () => {
    const poly: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [7, 8],
          [9, 10],
          [7, 8],
        ],
      ],
    };
    expect(representativePoint(poly)).toEqual([7, 8]);
  });

  it('returns the first vertex of a MultiPolygon', () => {
    const mp: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [11, 12],
            [13, 14],
            [11, 12],
          ],
        ],
      ],
    };
    expect(representativePoint(mp)).toEqual([11, 12]);
  });

  it('throws on a geometry with no coordinates', () => {
    expect(() => representativePoint({ type: 'LineString', coordinates: [] })).toThrow(
      /no coordinates/,
    );
  });

  it('throws on a Polygon with an empty ring set (outer ring absent → ?? [] arm)', () => {
    expect(() => representativePoint({ type: 'Polygon', coordinates: [] })).toThrow(
      /no coordinates/,
    );
  });

  it('throws on a Polygon with an empty outer ring', () => {
    expect(() => representativePoint({ type: 'Polygon', coordinates: [[]] })).toThrow(
      /no coordinates/,
    );
  });

  it('throws on a MultiPolygon with no polygons (outer absent → ?. short-circuit + ?? [] arm)', () => {
    expect(() => representativePoint({ type: 'MultiPolygon', coordinates: [] })).toThrow(
      /no coordinates/,
    );
  });

  it('throws on a MultiPolygon whose first polygon has an empty ring set', () => {
    expect(() => representativePoint({ type: 'MultiPolygon', coordinates: [[]] })).toThrow(
      /no coordinates/,
    );
  });

  it('throws on a MultiPolygon whose first ring is empty', () => {
    expect(() => representativePoint({ type: 'MultiPolygon', coordinates: [[[]]] })).toThrow(
      /no coordinates/,
    );
  });
});

describe('polygonsOf', () => {
  it('wraps a single Polygon', () => {
    const poly: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(polygonsOf(poly)).toEqual([poly]);
  });

  it('splits a MultiPolygon into its member Polygons', () => {
    const mp: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0],
          ],
        ],
        [
          [
            [2, 2],
            [2, 3],
            [3, 2],
            [2, 2],
          ],
        ],
      ],
    };
    const out = polygonsOf(mp);
    expect(out).toHaveLength(2);
    expect(out[0]!.type).toBe('Polygon');
  });

  it('yields nothing for a non-areal geometry', () => {
    expect(polygonsOf({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });
});

describe('clamp01', () => {
  it('maps NaN to 0', () => expect(clamp01(Number.NaN)).toBe(0));
  it('clamps below 0', () => expect(clamp01(-0.5)).toBe(0));
  it('clamps above 1', () => expect(clamp01(2)).toBe(1));
  it('passes through an in-range value', () => expect(clamp01(0.42)).toBe(0.42));
  it('keeps the boundaries', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});
