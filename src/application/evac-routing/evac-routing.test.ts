// BEACON — evacuation-routing tests (E5·T-223/T-226/T-227; FR-7, ADR-016). Proves the routing ladder
// never dead-ends (Art. XVI): engine success ⇒ ROUTED; any routing failure ⇒ a labeled straight-line
// HEURISTIC (avoids_hazard=false). Plus the deterministic suggested-start math. Golden + error + edge.
import { describe, it, expect } from 'vitest';
import { asId, makeEvacRoute, ok, err, isOk, DomainError } from '@/domain/index.js';
import type { EvacRoute, EvacRouteId, IncidentId } from '@/domain/index.js';
import type { RoutingPort, RouteRequest } from '@/ports/index.js';
import type { LineStringGeometry } from '@/domain/value-objects/geo.js';
import { planEvacRoute, computeSuggestedStart, routeClearanceSeconds, pathLengthMeters } from './evac-routing.js';

const INCIDENT = asId<IncidentId>('inc-1');
const HEUR_ID = asId<EvacRouteId>('evac-heuristic');
const REQUEST: RouteRequest = { incidentId: INCIDENT, from: [-121.6, 39.7], to: [-121.4, 39.9] };

function engineRoute(suggestedStart?: string): EvacRoute {
  return makeEvacRoute({
    id: asId<EvacRouteId>('evac-engine'),
    incidentId: INCIDENT,
    geom: { type: 'LineString', coordinates: [[-121.6, 39.7], [-121.5, 39.8], [-121.4, 39.9]] },
    avoidsHazard: true,
    ...(suggestedStart !== undefined ? { suggestedStart } : {}),
  });
}

function routing(result: () => Awaited<ReturnType<RoutingPort['route']>>): RoutingPort {
  return { route: async () => result() };
}

describe('planEvacRoute — engine success (ROUTED)', () => {
  it('returns the engine route when the RoutingPort succeeds', async () => {
    const res = await planEvacRoute({ request: REQUEST, heuristicRouteId: HEUR_ID }, routing(() => ok(engineRoute())));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.quality).toBe('ROUTED');
    expect(res.value.route.avoidsHazard).toBe(true);
    expect(res.value.label).toBe('engine route');
  });

  it('applies a suggested start to an engine route that lacks one', async () => {
    const input = { request: REQUEST, heuristicRouteId: HEUR_ID, suggestedStart: '2026-07-07T02:00:00.000Z' };
    const res = await planEvacRoute(input, routing(() => ok(engineRoute())));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.route.suggestedStart).toBe('2026-07-07T02:00:00.000Z');
  });

  it('does not override a suggested start the engine already set', async () => {
    const input = { request: REQUEST, heuristicRouteId: HEUR_ID, suggestedStart: '2026-07-07T02:00:00.000Z' };
    const res = await planEvacRoute(input, routing(() => ok(engineRoute('2026-07-07T01:00:00.000Z'))));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.route.suggestedStart).toBe('2026-07-07T01:00:00.000Z');
  });
});

describe('planEvacRoute — routing failure degrades to HEURISTIC (Art. XVI)', () => {
  it('builds a labeled straight-line fallback that does not claim to avoid the hazard', async () => {
    const res = await planEvacRoute(
      { request: REQUEST, heuristicRouteId: HEUR_ID },
      routing(() => err(new DomainError('NOT_FOUND', 'router down'))),
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.quality).toBe('HEURISTIC');
    expect(res.value.route.avoidsHazard).toBe(false);
    expect(res.value.route.geom.coordinates).toEqual([REQUEST.from, REQUEST.to]);
    expect(res.value.label).toContain('approximate');
  });

  it('carries a suggested start into the fallback route when provided', async () => {
    const input = { request: REQUEST, heuristicRouteId: HEUR_ID, suggestedStart: '2026-07-07T02:00:00.000Z' };
    const res = await planEvacRoute(input, routing(() => err(new DomainError('NOT_FOUND', 'down'))));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.route.suggestedStart).toBe('2026-07-07T02:00:00.000Z');
  });

  it('omits the suggested start from the fallback when none is provided', async () => {
    const res = await planEvacRoute(
      { request: REQUEST, heuristicRouteId: HEUR_ID },
      routing(() => err(new DomainError('NOT_FOUND', 'down'))),
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.route.suggestedStart).toBeUndefined();
  });
});

describe('computeSuggestedStart — deterministic (SPEC §5.7)', () => {
  it('subtracts clearance + safety margin from the projected hazard arrival', () => {
    // arrival 03:00Z − (1800s clearance + 600s margin) = 02:20Z
    const start = computeSuggestedStart({
      projectedHazardArrival: '2026-07-07T03:00:00.000Z',
      routeClearanceSec: 1800,
      safetyMarginSec: 600,
    });
    expect(start).toBe('2026-07-07T02:20:00.000Z');
  });

  it('uses the configured default safety margin when none is supplied', () => {
    const start = computeSuggestedStart({ projectedHazardArrival: '2026-07-07T03:00:00.000Z', routeClearanceSec: 0 });
    expect(start).not.toBeNull();
    expect(Date.parse(start!)).toBeLessThan(Date.parse('2026-07-07T03:00:00.000Z'));
  });

  it('returns null when the hazard arrival is unknown', () => {
    expect(computeSuggestedStart({ routeClearanceSec: 1800 })).toBeNull();
  });

  it('returns null when the hazard arrival is not a valid timestamp', () => {
    expect(computeSuggestedStart({ projectedHazardArrival: 'not-a-date', routeClearanceSec: 1800 })).toBeNull();
  });
});

describe('routeClearanceSeconds / pathLengthMeters — deterministic (SPEC §5.7)', () => {
  const straight: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [0, 1]] }; // ~111.2 km north
  const detour: LineStringGeometry = { type: 'LineString', coordinates: [[0, 0], [0.5, 0.5], [0, 1]] }; // longer path

  it('sums the great-circle length of a LineString path (metres)', () => {
    expect(pathLengthMeters(straight.coordinates)).toBeCloseTo(111_195, -2); // 1° latitude ≈ 111.2 km
  });

  it('scales clearance with path length: a hazard detour clears slower than a straight run', () => {
    const straightSec = routeClearanceSeconds(straight, 10);
    const detourSec = routeClearanceSeconds(detour, 10);
    expect(detourSec).toBeGreaterThan(straightSec);
    expect(straightSec).toBeCloseTo(pathLengthMeters(straight.coordinates) / 10, 3);
  });

  it('falls back to the default evac speed on a non-positive speed (never divides by zero — Art. XVI)', () => {
    expect(routeClearanceSeconds(straight, 0)).toBeCloseTo(routeClearanceSeconds(straight), 6);
    expect(Number.isFinite(routeClearanceSeconds(straight, -5))).toBe(true);
  });
});
