// BEACON — EVAC_ROUTE invariant tests (E1·T-078). geom must be LineString; avoidsHazard defaults true.
import { describe, it, expect } from 'vitest';
import { makeEvacRoute } from './evac-route.js';
import { asId } from './value-objects/ids.js';
import type { EvacRouteId, IncidentId } from './value-objects/ids.js';
import type { Geometry, LineStringGeometry } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

const id = asId<EvacRouteId>('e-1');
const incidentId = asId<IncidentId>('i-1');
const line: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [26.1, 44.4],
    [26.2, 44.5],
  ],
};

describe('makeEvacRoute', () => {
  it('builds a route and defaults avoidsHazard to true', () => {
    const r = makeEvacRoute({ id, incidentId, geom: line });
    expect(r.avoidsHazard).toBe(true);
    expect(r.geom.type).toBe('LineString');
    expect(r.suggestedStart).toBeUndefined();
  });

  it('honours an explicit avoidsHazard=false and suggestedStart', () => {
    const r = makeEvacRoute({
      id,
      incidentId,
      geom: line,
      avoidsHazard: false,
      suggestedStart: '2026-07-06T00:00:00Z',
    });
    expect(r.avoidsHazard).toBe(false);
    expect(r.suggestedStart).toBe('2026-07-06T00:00:00Z');
  });

  it('rejects a non-LineString geometry', () => {
    const point = { type: 'Point', coordinates: [26.1, 44.4] } as unknown as Geometry;
    expect(() => makeEvacRoute({ id, incidentId, geom: point })).toThrow(InvariantViolation);
  });

  it('rejects a LineString with fewer than 2 positions', () => {
    const stub = { type: 'LineString', coordinates: [[26.1, 44.4]] } as unknown as Geometry;
    expect(() => makeEvacRoute({ id, incidentId, geom: stub })).toThrow(InvariantViolation);
  });

  it('rejects a LineString with a malformed position', () => {
    const bad = { type: 'LineString', coordinates: [[26.1, 44.4], [26.2]] } as unknown as Geometry;
    expect(() => makeEvacRoute({ id, incidentId, geom: bad })).toThrow(InvariantViolation);
  });
});

// 2026-09-14 — the route in words (distance, duration, turns): the engine's figures, or nothing.
describe('makeEvacRoute — narrative fields', () => {
  const geom = {
    type: 'LineString' as const,
    coordinates: [
      [0, 0],
      [1, 1],
    ] as const,
  };
  const base = { id: asId<EvacRouteId>('r'), incidentId: asId<IncidentId>('i'), geom };

  it('keeps distance, duration and turns when the engine supplied them', () => {
    const r = makeEvacRoute({
      ...base,
      distanceM: 743,
      durationSec: 128.7,
      steps: ['Head north', 'Turn right'],
    });
    expect(r.distanceM).toBe(743);
    expect(r.durationSec).toBe(128.7);
    expect(r.steps).toEqual(['Head north', 'Turn right']);
  });

  it('drops a negative, non-finite or absent figure and an empty turn list rather than inventing a value', () => {
    const r = makeEvacRoute({ ...base, distanceM: -1, durationSec: Number.NaN, steps: [] });
    expect(r.distanceM).toBeUndefined();
    expect(r.durationSec).toBeUndefined();
    expect(r.steps).toBeUndefined();
    expect(makeEvacRoute(base).distanceM).toBeUndefined();
  });
});
