// BEACON — FloodZone factory tests. Invariants: non-empty id/zone, valid closed-ring Polygon geometry.
import { describe, it, expect } from 'vitest';
import { makeFloodZone } from './flood-zone.js';
import { InvariantViolation } from './errors.js';
import type { PolygonGeometry } from './value-objects/geo.js';

const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-90.2, 29.8],
      [-90.1, 29.8],
      [-90.1, 29.9],
      [-90.2, 29.8],
    ],
  ],
};

describe('makeFloodZone', () => {
  it('builds a valid flood zone', () => {
    const fz = makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: RING });
    expect(fz.id).toBe('nfhl:1:0');
    expect(fz.zone).toBe('AE');
    expect(fz.geom).toEqual(RING);
  });

  it('accepts common FEMA FLD_ZONE codes', () => {
    for (const zone of ['AE', 'X', 'A', 'AO', 'VE', 'D']) {
      expect(makeFloodZone({ id: 'nfhl:1:0', zone, geom: RING }).zone).toBe(zone);
    }
  });

  it('rejects an empty id', () => {
    expect(() => makeFloodZone({ id: '', zone: 'AE', geom: RING })).toThrow(InvariantViolation);
  });

  it('rejects a blank/whitespace-only id', () => {
    expect(() => makeFloodZone({ id: '   ', zone: 'AE', geom: RING })).toThrow(InvariantViolation);
  });

  it('rejects an empty zone', () => {
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: '', geom: RING })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a non-Polygon geometry', () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [-90, 29],
        [-89, 30],
      ],
    } as unknown as PolygonGeometry;
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: line })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a Polygon with no rings', () => {
    const empty: PolygonGeometry = { type: 'Polygon', coordinates: [] };
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: empty })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a ring with fewer than 4 positions', () => {
    const tooShort: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-90.2, 29.8],
          [-90.1, 29.8],
          [-90.2, 29.8],
        ],
      ],
    };
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: tooShort })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects an unclosed ring (first != last position)', () => {
    const unclosed: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-90.2, 29.8],
          [-90.1, 29.8],
          [-90.1, 29.9],
          [-90.2, 29.9],
        ],
      ],
    };
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: unclosed })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a ring with a non-numeric position', () => {
    const bad = {
      type: 'Polygon',
      coordinates: [
        [
          [-90.2, 29.8],
          ['x', 29.8],
          [-90.1, 29.9],
          [-90.2, 29.8],
        ],
      ],
    } as unknown as PolygonGeometry;
    expect(() => makeFloodZone({ id: 'nfhl:1:0', zone: 'AE', geom: bad })).toThrow(
      InvariantViolation,
    );
  });
});
