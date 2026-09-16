// BEACON — in-memory RoutingPort adapter tests (FR-7, EV7). Deterministic: injected id minter, fixed
// hazard fixtures, Turf SpatialPort (no network, no wall-clock). Proves the route avoids the hazard.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { Geometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import { makeTurfSpatialPort } from '@/adapters/spatial/turf-spatial.js';
import { makeRoutingAdapter } from './memory-routing.js';

const INCIDENT = asId<IncidentId>('inc-1');

// A square hazard straddling the direct path from [0,0] to [4,0] (the segment y=0 runs through it).
const HAZARD: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1, -1],
      [3, -1],
      [3, 1],
      [1, 1],
      [1, -1],
    ],
  ],
};

function makeAdapter(hazardFor: (id: IncidentId) => Geometry | undefined) {
  let n = 0;
  return makeRoutingAdapter({
    spatial: makeTurfSpatialPort(),
    hazardFor,
    newId: (p) => `${p}-${++n}`,
  });
}

describe('makeRoutingAdapter.route', () => {
  it('routes AROUND a hazard the straight line would cross (avoids_hazard=true)', async () => {
    const adapter = makeAdapter(() => HAZARD);
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [4, 0] });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.avoidsHazard).toBe(true);
    expect(r.value.engine).toBe('heuristic'); // the honest engine tag the route panel labels from
    expect(r.value.geom.coordinates.length).toBeGreaterThan(2); // a detour waypoint was inserted
    // The returned path provably does not intersect the hazard footprint (deterministic, Turf).
    const intersects = makeTurfSpatialPort().intersect(r.value.geom, HAZARD);
    expect(isOk(intersects) && intersects.value).toBe(false);
  });

  it('keeps the straight line when it already clears the hazard (avoids_hazard=true, 2 points)', async () => {
    const adapter = makeAdapter(() => HAZARD);
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 5], to: [4, 5] }); // north of the hazard
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.avoidsHazard).toBe(true);
    expect(r.value.geom.coordinates).toEqual([
      [0, 5],
      [4, 5],
    ]);
  });

  it('returns a labelled straight line when no hazard footprint is known (avoids_hazard=false)', async () => {
    const adapter = makeAdapter(() => undefined);
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [4, 0] });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.avoidsHazard).toBe(false);
    expect(r.value.engine).toBe('heuristic'); // even the concede-rung straight line names its engine
    expect(r.value.geom.coordinates).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it('honours avoidHazard=false (no avoidance attempted, straight line through the hazard)', async () => {
    const adapter = makeAdapter(() => HAZARD);
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [0, 0],
      to: [4, 0],
      avoidHazard: false,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.avoidsHazard).toBe(false);
    expect(r.value.geom.coordinates).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });
});
