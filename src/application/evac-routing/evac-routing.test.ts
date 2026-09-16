// BEACON — evacuation-routing tests (E5·T-223/T-226/T-227; FR-7, ADR-016). Proves the routing ladder
// never dead-ends (Art. XVI): engine success ⇒ ROUTED; any routing failure ⇒ a labeled straight-line
// HEURISTIC (avoids_hazard=false). Plus the deterministic suggested-start math. Golden + error + edge.
import { describe, it, expect } from 'vitest';
import { asId, makeEvacRoute, ok, err, isOk, DomainError } from '@/domain/index.js';
import type { EvacRoute, EvacRouteId, IncidentId } from '@/domain/index.js';
import type { RoutingPort, RouteRequest } from '@/ports/index.js';
import type { LineStringGeometry } from '@/domain/value-objects/geo.js';
import {
  planEvacRoute,
  computeSuggestedStart,
  routeClearanceSeconds,
  pathLengthMeters,
} from './evac-routing.js';
import { DEFAULT_EVAC_SPEED_MPS } from '@/application/shared/config.js';

const INCIDENT = asId<IncidentId>('inc-1');
const HEUR_ID = asId<EvacRouteId>('evac-heuristic');
const REQUEST: RouteRequest = { incidentId: INCIDENT, from: [-121.6, 39.7], to: [-121.4, 39.9] };

function engineRoute(suggestedStart?: string): EvacRoute {
  return makeEvacRoute({
    id: asId<EvacRouteId>('evac-engine'),
    incidentId: INCIDENT,
    geom: {
      type: 'LineString',
      coordinates: [
        [-121.6, 39.7],
        [-121.5, 39.8],
        [-121.4, 39.9],
      ],
    },
    avoidsHazard: true,
    ...(suggestedStart !== undefined ? { suggestedStart } : {}),
  });
}

function routing(result: () => Awaited<ReturnType<RoutingPort['route']>>): RoutingPort {
  return { route: async () => result() };
}

describe('planEvacRoute — engine success (ROUTED)', () => {
  it('returns the engine route when the RoutingPort succeeds', async () => {
    const res = await planEvacRoute(
      { request: REQUEST, heuristicRouteId: HEUR_ID },
      routing(() => ok(engineRoute())),
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.quality).toBe('ROUTED');
    expect(res.value.route.avoidsHazard).toBe(true);
    expect(res.value.label).toBe('engine route');
  });

  it('applies a suggested start to an engine route that lacks one', async () => {
    const input = {
      request: REQUEST,
      heuristicRouteId: HEUR_ID,
      suggestedStart: '2026-07-07T02:00:00.000Z',
    };
    const res = await planEvacRoute(
      input,
      routing(() => ok(engineRoute())),
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.route.suggestedStart).toBe('2026-07-07T02:00:00.000Z');
  });

  it('does not override a suggested start the engine already set', async () => {
    const input = {
      request: REQUEST,
      heuristicRouteId: HEUR_ID,
      suggestedStart: '2026-07-07T02:00:00.000Z',
    };
    const res = await planEvacRoute(
      input,
      routing(() => ok(engineRoute('2026-07-07T01:00:00.000Z'))),
    );
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
    const input = {
      request: REQUEST,
      heuristicRouteId: HEUR_ID,
      suggestedStart: '2026-07-07T02:00:00.000Z',
    };
    const res = await planEvacRoute(
      input,
      routing(() => err(new DomainError('NOT_FOUND', 'down'))),
    );
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
    const start = computeSuggestedStart({
      projectedHazardArrival: '2026-07-07T03:00:00.000Z',
      routeClearanceSec: 0,
    });
    expect(start).not.toBeNull();
    expect(Date.parse(start!)).toBeLessThan(Date.parse('2026-07-07T03:00:00.000Z'));
  });

  it('returns null when the hazard arrival is unknown', () => {
    expect(computeSuggestedStart({ routeClearanceSec: 1800 })).toBeNull();
  });

  it('returns null when the hazard arrival is not a valid timestamp', () => {
    expect(
      computeSuggestedStart({ projectedHazardArrival: 'not-a-date', routeClearanceSec: 1800 }),
    ).toBeNull();
  });
});

describe('routeClearanceSeconds / pathLengthMeters — deterministic (SPEC §5.7)', () => {
  const straight: LineStringGeometry = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [0, 1],
    ],
  }; // ~111.2 km north
  const detour: LineStringGeometry = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [0.5, 0.5],
      [0, 1],
    ],
  }; // longer path

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

// 2026-09-14 — the straight-line rung states its own distance and clearance estimate, labelled as such.
describe('planEvacRoute — the heuristic route in words', () => {
  it('carries the great-circle distance and the clearance estimate at the configured evacuation speed', async () => {
    const res = await planEvacRoute(
      { request: REQUEST, heuristicRouteId: HEUR_ID },
      routing(() => err(new DomainError('NOT_FOUND', 'router down'))),
    );
    if (!isOk(res)) throw new Error('expected ok');
    const { distanceM, durationSec, steps } = res.value.route;
    expect(distanceM).toBeGreaterThan(25_000); // (-121.6,39.7) → (-121.4,39.9) is ~28 km
    expect(distanceM).toBeLessThan(31_000);
    expect(durationSec).toBeCloseTo(distanceM! / DEFAULT_EVAC_SPEED_MPS, 6);
    expect(steps).toBeUndefined(); // a straight line has no turns, and none are invented
  });
});

describe('planEvacRoute — every served route states its distance and duration (2026-09-14)', () => {
  it('fills a distance-less engine route with the length of its own path at the configured speed', async () => {
    const bare = makeEvacRoute({
      id: asId<EvacRouteId>('r-bare'),
      incidentId: asId<IncidentId>('inc-1'),
      geom: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      avoidsHazard: true,
      engine: 'heuristic',
    });
    const res = await planEvacRoute(
      {
        request: { incidentId: asId<IncidentId>('inc-1'), from: [0, 0], to: [1, 0] },
        heuristicRouteId: asId<EvacRouteId>('evac-h'),
      },
      routing(() => ok(bare)),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.quality).toBe('ROUTED');
    // One degree of longitude on the equator ≈ 111.2 km (great-circle).
    expect(res.value.route.distanceM).toBeCloseTo(111_195, -2);
    expect(res.value.route.durationSec).toBeCloseTo(111_195 / DEFAULT_EVAC_SPEED_MPS, 0);
  });

  it('leaves a route that already states its distance untouched', async () => {
    const stated = makeEvacRoute({
      id: asId<EvacRouteId>('r-ors'),
      incidentId: asId<IncidentId>('inc-1'),
      geom: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      avoidsHazard: true,
      engine: 'ors',
      distanceM: 123_456,
      durationSec: 4_200,
    });
    const res = await planEvacRoute(
      {
        request: { incidentId: asId<IncidentId>('inc-1'), from: [0, 0], to: [1, 0] },
        heuristicRouteId: asId<EvacRouteId>('evac-h'),
      },
      routing(() => ok(stated)),
    );
    if (!isOk(res)) return;
    expect(res.value.route.distanceM).toBe(123_456);
    expect(res.value.route.durationSec).toBe(4_200);
  });

  it('fills only the missing figure — a stated duration survives, a stated distance gets its clearance', async () => {
    const line = {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 0],
      ] as const,
    };
    const base = {
      incidentId: asId<IncidentId>('inc-1'),
      geom: line,
      avoidsHazard: true,
      engine: 'ors' as const,
    };
    const plan = (route: ReturnType<typeof makeEvacRoute>) =>
      planEvacRoute(
        {
          request: { incidentId: asId<IncidentId>('inc-1'), from: [0, 0], to: [1, 0] },
          heuristicRouteId: asId<EvacRouteId>('evac-h'),
        },
        routing(() => ok(route)),
      );
    const durationOnly = await plan(
      makeEvacRoute({ ...base, id: asId<EvacRouteId>('r-d'), durationSec: 4_200 }),
    );
    const distanceOnly = await plan(
      makeEvacRoute({ ...base, id: asId<EvacRouteId>('r-m'), distanceM: 123_456 }),
    );
    if (!isOk(durationOnly) || !isOk(distanceOnly)) throw new Error('expected ok');
    expect(durationOnly.value.route.durationSec).toBe(4_200); // engine figure kept
    expect(durationOnly.value.route.distanceM).toBeCloseTo(111_195, -2); // path length filled
    expect(distanceOnly.value.route.distanceM).toBe(123_456); // engine figure kept
    expect(distanceOnly.value.route.durationSec).toBeCloseTo(123_456 / DEFAULT_EVAC_SPEED_MPS, 6);
  });
});
