// BEACON — SpatialPort selector tests (FEATURE_SPATIAL routing; ADR-005).
import { describe, expect, it } from 'vitest';
import { isErr } from '@/domain/shared/result.js';
import type { Position } from '@/domain/value-objects/geo.js';
import { makeSpatialPort, PostgisSpatialPort, TurfSpatialPort } from './index.js';

const point: Position = [0, 0];
const square = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ] as Position[],
  ],
};

describe('makeSpatialPort', () => {
  it('defaults to the Turf adapter', () => {
    expect(makeSpatialPort()).toBeInstanceOf(TurfSpatialPort);
  });

  it('selects the PostGIS stub for mode "postgis"', () => {
    expect(makeSpatialPort('postgis')).toBeInstanceOf(PostgisSpatialPort);
  });

  it('falls back to Turf for an unknown mode', () => {
    expect(makeSpatialPort('nonsense')).toBeInstanceOf(TurfSpatialPort);
  });

  it('the PostGIS stub returns err from its methods', () => {
    const port = makeSpatialPort('postgis');
    const r = port.pointInPolygon(point, square);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVARIANT_VIOLATION');
  });
});
