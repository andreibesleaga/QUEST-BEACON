import { describe, it, expect } from 'vitest';
import { makeRegion, REGION_SCOPES } from './region.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { RegionId } from './value-objects/ids.js';
import type { BBox } from './value-objects/geo.js';

const id = asId<RegionId>('11111111-1111-1111-1111-111111111111');
const bbox: BBox = [-123, 37, -121, 39];

describe('makeRegion', () => {
  it('builds a valid region', () => {
    const r = makeRegion({
      id,
      name: 'Bay Area',
      scope: 'COMMUNITY',
      bbox,
      enabledAdapters: ['firms-adapter'],
    });
    expect(r.scope).toBe('COMMUNITY');
    expect(r.enabledAdapters).toEqual(['firms-adapter']);
  });

  it('defaults enabledAdapters to []', () => {
    expect(makeRegion({ id, name: 'X', scope: 'STATE', bbox }).enabledAdapters).toEqual([]);
  });

  it('accepts every schema scope value', () => {
    for (const scope of REGION_SCOPES) {
      expect(makeRegion({ id, name: 'X', scope, bbox }).scope).toBe(scope);
    }
  });

  it('rejects a scope outside the enum', () => {
    // @ts-expect-error invalid enum at compile time; runtime guard also rejects
    expect(() => makeRegion({ id, name: 'X', scope: 'PLANET', bbox })).toThrow(InvariantViolation);
  });

  it('rejects an empty name', () => {
    expect(() => makeRegion({ id, name: '   ', scope: 'STATE', bbox })).toThrow(InvariantViolation);
  });

  it('rejects an inverted bbox (min > max)', () => {
    expect(() => makeRegion({ id, name: 'X', scope: 'STATE', bbox: [10, 10, 0, 0] })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a malformed bbox', () => {
    expect(() =>
      makeRegion({ id, name: 'X', scope: 'STATE', bbox: [1, 2, 3] as unknown as BBox }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a non-string adapter id', () => {
    expect(() =>
      makeRegion({ id, name: 'X', scope: 'STATE', bbox, enabledAdapters: [''] }),
    ).toThrow(InvariantViolation);
  });
});

// ── 2026-09-14: the region's outline (ADR-042) ────────────────────────────────────────────────────────
describe('Region.boundary', () => {
  const base = {
    id: asId<RegionId>('x'),
    name: 'X',
    scope: 'COUNTRY' as const,
    bbox: [0, 0, 10, 10] as const,
  };
  const ring = [
    [1, 1],
    [9, 1],
    [9, 9],
    [1, 1],
  ] as const;

  it('accepts a Polygon and a MultiPolygon, and carries it on the entity', () => {
    const poly = makeRegion({ ...base, boundary: { type: 'Polygon', coordinates: [ring] } });
    expect(poly.boundary?.type).toBe('Polygon');
    const multi = makeRegion({
      ...base,
      boundary: { type: 'MultiPolygon', coordinates: [[ring], [ring]] },
    });
    expect(multi.boundary?.type).toBe('MultiPolygon');
    expect(makeRegion(base).boundary).toBeUndefined();
  });

  it('rejects an outline that is not an area', () => {
    expect(() => makeRegion({ ...base, boundary: { type: 'Point', coordinates: [1, 1] } })).toThrow(
      /Polygon or MultiPolygon/,
    );
    expect(() =>
      makeRegion({
        ...base,
        boundary: {
          type: 'LineString',
          coordinates: [
            [1, 1],
            [2, 2],
          ],
        },
      }),
    ).toThrow(/Polygon or MultiPolygon/);
  });

  it('rejects a ring with fewer than four positions, an empty geometry, or a non-position vertex', () => {
    expect(() =>
      makeRegion({
        ...base,
        boundary: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 1],
              [2, 2],
              [1, 1],
            ],
          ],
        },
      }),
    ).toThrow(/four/);
    expect(() =>
      makeRegion({ ...base, boundary: { type: 'MultiPolygon', coordinates: [] } }),
    ).toThrow(/four/);
    expect(() =>
      makeRegion({
        ...base,
        boundary: {
          type: 'Polygon',
          coordinates: [[[1, 1], [2, 2], [3, 3], 'x' as unknown as [number, number]]],
        },
      }),
    ).toThrow(/four/);
  });
});
