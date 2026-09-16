// BEACON — map/prediction geometry helper tests (W2b). Pure, deterministic: proves the BBox→ring, convex
// Sutherland–Hodgman clip (all inside/entering/leaving/outside edge cases), shoelace area, expand, bounds,
// wire-rounding and compass helpers behave exactly. These underpin the outage AOI layer + the NFHL∩crest
// flood-impact projection, so their determinism is load-bearing.
import { describe, it, expect } from 'vitest';
import type { Position, Geometry } from '@/domain/value-objects/geo.js';
import {
  bboxToRing,
  expandBbox,
  boundsOf,
  ringArea,
  clipRingToRect,
  roundPosition,
  roundRings,
  compass8,
} from './map-geometry.js';

describe('bboxToRing', () => {
  it('produces a closed CCW rectangle ring (first == last)', () => {
    const ring = bboxToRing([0, 0, 10, 5]);
    expect(ring).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
      [0, 0],
    ]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});

describe('expandBbox', () => {
  it('grows the box outward on every side', () => {
    expect(expandBbox([0, 0, 10, 10], 1)).toEqual([-1, -1, 11, 11]);
  });
});

describe('boundsOf', () => {
  it('bounds a Point', () => {
    expect(boundsOf({ type: 'Point', coordinates: [3, 4] })).toEqual([3, 4, 3, 4]);
  });
  it('bounds a LineString', () => {
    const g: Geometry = {
      type: 'LineString',
      coordinates: [
        [0, 1],
        [5, -2],
        [3, 9],
      ],
    };
    expect(boundsOf(g)).toEqual([0, -2, 5, 9]);
  });
  it('bounds a Polygon (recurses through rings)', () => {
    const g: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 6],
          [0, 6],
          [0, 0],
        ],
      ],
    };
    expect(boundsOf(g)).toEqual([0, 0, 4, 6]);
  });
});

describe('ringArea', () => {
  it('computes the absolute shoelace area of a unit square', () => {
    expect(
      ringArea([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ).toBeCloseTo(1, 12);
  });
  it('is orientation-independent (absolute)', () => {
    expect(
      ringArea([
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ]),
    ).toBeCloseTo(1, 12);
  });
});

describe('clipRingToRect', () => {
  const rect: [number, number, number, number] = [0, 0, 10, 10];

  it('keeps a ring fully inside the rectangle', () => {
    const inside: Position[] = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
      [1, 1],
    ];
    const out = clipRingToRect(inside, rect);
    expect(ringArea(out)).toBeCloseTo(1, 9);
  });

  it('clips a ring that straddles the rectangle to the overlap (all SH edge cases)', () => {
    // A square from (-5,-5) to (5,5) overlapping the rect at the quadrant (0,0)-(5,5) → area 25.
    const straddle: Position[] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
      [-5, -5],
    ];
    const out = clipRingToRect(straddle, rect);
    expect(ringArea(out)).toBeCloseTo(25, 6);
    expect(out[0]).toEqual(out[out.length - 1]); // closed
  });

  it('returns [] when the ring lies wholly outside the rectangle', () => {
    const outside: Position[] = [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
      [20, 20],
    ];
    expect(clipRingToRect(outside, rect)).toEqual([]);
  });

  it('returns [] for a degenerate (sub-3-vertex) ring', () => {
    expect(clipRingToRect([], rect)).toEqual([]);
    expect(clipRingToRect([[1, 1]], rect)).toEqual([]);
  });

  it('accepts an already-open ring (first != last) and closes the result', () => {
    const open: Position[] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]; // no closing vertex
    const out = clipRingToRect(open, rect);
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(ringArea(out)).toBeCloseTo(4, 9);
  });
});

describe('roundPosition / roundRings', () => {
  it('rounds to the default sub-metre precision (no-op on coarse coordinates)', () => {
    expect(roundPosition([-121.61, 39.72])).toEqual([-121.61, 39.72]);
  });
  it('rounds a high-precision coordinate deterministically', () => {
    expect(roundPosition([1.234567891, 2.987654321])).toEqual([1.234568, 2.987654]);
  });
  it('rounds to a custom precision', () => {
    expect(roundPosition([1.239, 2.981], 2)).toEqual([1.24, 2.98]);
  });
  it('rounds every position of every ring', () => {
    const rings: readonly (readonly Position[])[] = [
      [
        [1.2345678, 2.3456789],
        [3, 4],
      ],
    ];
    expect(roundRings(rings)).toEqual([
      [
        [1.234568, 2.345679],
        [3, 4],
      ],
    ]);
  });
});

describe('compass8', () => {
  it('maps the 8 cardinal/intercardinal sectors', () => {
    expect(compass8(0)).toBe('N');
    expect(compass8(45)).toBe('NE');
    expect(compass8(90)).toBe('E');
    expect(compass8(135)).toBe('SE');
    expect(compass8(180)).toBe('S');
    expect(compass8(225)).toBe('SW');
    expect(compass8(270)).toBe('W');
    expect(compass8(315)).toBe('NW');
  });
  it('wraps around 360 and handles negative bearings', () => {
    expect(compass8(360)).toBe('N');
    expect(compass8(-45)).toBe('NW');
    expect(compass8(359)).toBe('N'); // rounds to 360 → 0 sector
  });
  it('rounds to the nearest sector', () => {
    expect(compass8(22)).toBe('N');
    expect(compass8(23)).toBe('NE');
  });
});
