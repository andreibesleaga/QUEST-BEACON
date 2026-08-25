// BEACON — Turf SpatialPort tests (FEATURE_SPATIAL=turf; ADR-005). Deterministic fixtures only.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import type { PointGeometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { makeTurfSpatialPort, TurfSpatialPort } from './turf-spatial.js';

// Unit square around the origin, RFC 7946 closed ring (first == last).
const unitSquare: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ],
};

// A square offset so it overlaps the unit square's top-right quadrant.
const overlapping: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

// A square far to the east — disjoint from the unit square.
const disjoint: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 10],
      [12, 10],
      [12, 12],
      [10, 12],
      [10, 10],
    ],
  ],
};

const origin: PointGeometry = { type: 'Point', coordinates: [0, 0] };

describe('TurfSpatialPort.pointInPolygon', () => {
  const port = makeTurfSpatialPort();

  it('returns ok(true) for a point inside the polygon', () => {
    const inside: Position = [0, 0];
    const r = port.pointInPolygon(inside, unitSquare);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(true);
  });

  it('returns ok(false) for a point outside the polygon', () => {
    const outside: Position = [5, 5];
    const r = port.pointInPolygon(outside, unitSquare);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(false);
  });
});

describe('TurfSpatialPort.buffer', () => {
  const port = makeTurfSpatialPort();

  it('buffers a point by N meters into a Polygon', () => {
    const r = port.buffer(origin, 100);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.type).toBe('Polygon');
      expect(r.value.coordinates.length).toBeGreaterThan(0);
    }
  });

  it('rejects a negative distance with INVARIANT_VIOLATION', () => {
    const r = port.buffer(origin, -5);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('rejects a NaN distance with INVARIANT_VIOLATION', () => {
    const r = port.buffer(origin, Number.NaN);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('rejects a non-finite distance with INVARIANT_VIOLATION', () => {
    const r = port.buffer(origin, Number.POSITIVE_INFINITY);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('TurfSpatialPort.intersect', () => {
  const port = new TurfSpatialPort();

  it('returns ok(true) for overlapping polygons', () => {
    const r = port.intersect(unitSquare, overlapping);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(true);
  });

  it('returns ok(false) for disjoint polygons', () => {
    const r = port.intersect(unitSquare, disjoint);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(false);
  });
});
