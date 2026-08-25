// BEACON — EVAC_ROUTE invariant tests (E1·T-078). geom must be LineString; avoidsHazard defaults true.
import { describe, it, expect } from 'vitest';
import { makeEvacRoute } from './evac-route.js';
import { asId } from './value-objects/ids.js';
import type { EvacRouteId, IncidentId } from './value-objects/ids.js';
import type { Geometry, LineStringGeometry } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

const id = asId<EvacRouteId>('e-1');
const incidentId = asId<IncidentId>('i-1');
const line: LineStringGeometry = { type: 'LineString', coordinates: [[26.1, 44.4], [26.2, 44.5]] };

describe('makeEvacRoute', () => {
  it('builds a route and defaults avoidsHazard to true', () => {
    const r = makeEvacRoute({ id, incidentId, geom: line });
    expect(r.avoidsHazard).toBe(true);
    expect(r.geom.type).toBe('LineString');
    expect(r.suggestedStart).toBeUndefined();
  });

  it('honours an explicit avoidsHazard=false and suggestedStart', () => {
    const r = makeEvacRoute({ id, incidentId, geom: line, avoidsHazard: false, suggestedStart: '2026-07-06T00:00:00Z' });
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
