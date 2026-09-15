// BEACON — region-clip tests. The live defect this guards: a fixture recorded around Butte County served to
// Romania as Romania's own cell sites and infrastructure (2026-09-13). Every case below is one way an
// entity can say where it is, and one way it can say nothing.
import { describe, it, expect } from 'vitest';
import type { BBox, MultiPolygonGeometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import {
  clipToRegion,
  encloses,
  inBoundary,
  intersects,
  isBBox,
  placementOf,
  positionsOf,
} from './region-clip.js';

/** Romania, as regions.json draws it (rounded outward). */
const RO: BBox = [20.2, 43.6, 29.8, 48.3];
const BUTTE = [-121.87, 39.75] as const;
const GALATI = [28.05, 45.43] as const;

describe('placementOf — reads only the domain’s placing fields', () => {
  it('a Point geometry, under either field name the domain uses', () => {
    expect(placementOf({ geometry: { type: 'Point', coordinates: GALATI } })).toEqual([
      [28.05, 45.43, 28.05, 45.43],
    ]);
    expect(placementOf({ geom: { type: 'Point', coordinates: GALATI } })).toEqual([
      [28.05, 45.43, 28.05, 45.43],
    ]);
  });

  it('a Polygon / MultiPolygon collapses to its bounds', () => {
    const ring = [
      [22, 37.5],
      [23, 37.5],
      [23, 38.5],
      [22, 37.5],
    ];
    expect(placementOf({ geometry: { type: 'Polygon', coordinates: [ring] } })).toEqual([
      [22, 37.5, 23, 38.5],
    ]);
    expect(placementOf({ geometry: { type: 'MultiPolygon', coordinates: [[ring]] } })).toEqual([
      [22, 37.5, 23, 38.5],
    ]);
  });

  it('a bare position, and a bbox or area', () => {
    expect(placementOf({ position: BUTTE })).toEqual([[-121.87, 39.75, -121.87, 39.75]]);
    expect(placementOf({ bbox: [1, 2, 3, 4] })).toEqual([[1, 2, 3, 4]]);
    expect(placementOf({ area: [1, 2, 3, 4] })).toEqual([[1, 2, 3, 4]]);
  });

  it('says nothing for an entity with no placing field — a range is not a coordinate', () => {
    expect(placementOf({ stageRange: [2, 5], label: 'gauge' })).toBeNull();
    expect(placementOf({ position: 'north' })).toBeNull();
    expect(placementOf({ bbox: [1, 2, 3] })).toBeNull();
    expect(placementOf({ geometry: { type: 'Point' } })).toBeNull(); // no coordinates
    expect(placementOf({ geometry: { type: 'Polygon', coordinates: [] } })).toBeNull(); // empty
    expect(placementOf({ geometry: 'POINT(1 2)' })).toBeNull(); // not GeoJSON
    expect(placementOf({ geometry: null })).toBeNull();
  });

  it('says nothing for a non-object', () => {
    expect(placementOf(null)).toBeNull();
    expect(placementOf('text')).toBeNull();
    expect(placementOf([1, 2])).toBeNull();
  });

  it('reports every placing field an entity carries', () => {
    const boxes = placementOf({ position: GALATI, area: [27, 45, 29, 46] });
    expect(boxes).toHaveLength(2);
  });
});

describe('clipToRegion — what is about the region stays', () => {
  it('drops a recording from elsewhere and keeps one from here, in order', () => {
    const here = { id: 'a', position: GALATI };
    const elsewhere = { id: 'b', position: BUTTE };
    const out = clipToRegion([elsewhere, here], RO);
    expect(out.kept).toEqual([here]);
    expect(out.kept[0]).toBe(here); // the same object, never a copy
    expect(out.spatial).toBe(2);
  });

  it('keeps every entity that has no location — nothing about it can be judged', () => {
    const weather = { label: 'wind', speedKmh: 12 };
    const out = clipToRegion([weather, { id: 'x', position: BUTTE }], RO);
    expect(out.kept).toEqual([weather]);
    expect(out.spatial).toBe(1);
  });

  it('a perimeter that crosses the border is about the region', () => {
    const crossing = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [19.5, 45],
            [21, 45],
            [21, 46],
            [19.5, 45],
          ],
        ],
      },
    };
    expect(clipToRegion([crossing], RO).kept).toEqual([crossing]);
  });

  it('a polygon that ENCLOSES the region, with no vertex inside it, is still about the region', () => {
    const enclosing = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 40],
            [40, 40],
            [40, 55],
            [10, 55],
            [10, 40],
          ],
        ],
      },
    };
    expect(clipToRegion([enclosing], RO).kept).toEqual([enclosing]);
  });

  it('an entity with several placing fields stays if ANY of them touches', () => {
    const mixed = { position: BUTTE, area: [27, 45, 29, 46] };
    expect(clipToRegion([mixed], RO).kept).toEqual([mixed]);
  });

  it('an empty input is an empty, unjudged output', () => {
    expect(clipToRegion([], RO)).toEqual({ kept: [], spatial: 0 });
  });
});

describe('the box tests', () => {
  it('intersects is symmetric and counts a shared edge', () => {
    expect(intersects([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(intersects([1, 1, 2, 2], [0, 0, 1, 1])).toBe(true);
    expect(intersects([0, 0, 1, 1], [1.01, 0, 2, 1])).toBe(false);
    expect(intersects([0, 0, 1, 1], [0, 1.01, 1, 2])).toBe(false);
  });

  it('isBBox wants exactly four numbers', () => {
    expect(isBBox([1, 2, 3, 4])).toBe(true);
    expect(isBBox([1, 2, 3])).toBe(false);
    expect(isBBox([1, 2, 3, '4'])).toBe(false);
    expect(isBBox('1,2,3,4')).toBe(false);
  });
});

describe('boundary rule — a synthetic triangle', () => {
  // A triangle inside RO's rectangle; a hole cut out of its middle.
  const triangle: PolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [22, 44],
        [28, 44],
        [25, 48],
        [22, 44],
      ],
      [
        [24.5, 45],
        [25.5, 45],
        [25, 46],
        [24.5, 45],
      ],
    ],
  };
  const shape = { bbox: RO, boundary: triangle };

  it('inBoundary: inside the outer ring, outside a hole, outside the ring', () => {
    expect(inBoundary([25, 44.5], triangle)).toBe(true);
    expect(inBoundary([25, 45.3], triangle)).toBe(false); // in the hole
    expect(inBoundary([21, 47], triangle)).toBe(false); // inside the bbox, outside the outline
    expect(inBoundary([22, 43.98], triangle, 0.03)).toBe(true); // 2 km off an edge, within tolerance
    expect(inBoundary([22, 43.9], triangle, 0.03)).toBe(false); // 11 km off, beyond it
    expect(inBoundary([25, 44.5], { type: 'Point', coordinates: [25, 44.5] })).toBe(false); // not an outline
  });

  it('MultiPolygon: any part counts', () => {
    const two: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        triangle.coordinates,
        [
          [
            [20.3, 43.7],
            [20.6, 43.7],
            [20.45, 43.9],
            [20.3, 43.7],
          ],
        ],
      ],
    };
    expect(inBoundary([20.45, 43.75], two)).toBe(true);
    expect(inBoundary([29, 48], two)).toBe(false);
  });

  it('clipToRegion judges by the outline when one is given, by the bbox otherwise', () => {
    const inside = { id: 'in', position: [25, 44.5] as const };
    const corner = { id: 'corner', position: [21, 47] as const }; // inside bbox, outside triangle
    expect(clipToRegion([inside, corner], RO).kept).toEqual([inside, corner]);
    expect(clipToRegion([inside, corner], shape).kept).toEqual([inside]);
  });

  it('a perimeter with one vertex inside the outline is kept; one entirely outside is dropped', () => {
    const crossing = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [24, 44.2],
            [21, 46.9],
            [21, 47],
            [24, 44.2],
          ],
        ],
      },
    };
    const outside = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [20.5, 46.5],
            [21, 46.5],
            [21, 47],
            [20.5, 46.5],
          ],
        ],
      },
    };
    expect(clipToRegion([crossing, outside], shape).kept).toEqual([crossing]);
  });

  it('positionsOf: vertices, position, and a box’s corners plus centre', () => {
    expect(positionsOf({ position: [1, 2] })).toEqual([[1, 2]]);
    expect(positionsOf({ bbox: [0, 0, 2, 2] })).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ]);
    expect(
      positionsOf({
        geom: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(positionsOf('nope')).toEqual([]);
    expect(positionsOf({ geometry: 'WKT' })).toEqual([]);
  });

  it('encloses: containment is not intersection', () => {
    expect(encloses([0, 0, 10, 10], [1, 1, 2, 2])).toBe(true);
    expect(encloses([1, 1, 2, 2], [0, 0, 10, 10])).toBe(false);
  });
});
