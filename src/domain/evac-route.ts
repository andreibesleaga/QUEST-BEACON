// BEACON — EVAC_ROUTE entity (E1·T-079). Hazard-avoiding evacuation route (EV7).
// Pure domain: no framework/HTTP/DB imports (F9).
import type { EvacRouteId, IncidentId } from './value-objects/ids.js';
import type { LineStringGeometry, Geometry } from './value-objects/geo.js';
import { isPosition } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

/**
 * Which engine produced the geometry — 'ors' (real road routing) vs 'heuristic' (buffer-and-detour or
 * labelled straight line). Optional so a route from an older producer stays valid; a consumer that gets
 * no engine simply shows no engine label (absent, never guessed).
 */
export type RouteEngine = 'ors' | 'heuristic';

export interface EvacRoute {
  readonly id: EvacRouteId;
  readonly incidentId: IncidentId;
  readonly geom: LineStringGeometry; // a route is a path — LineString only (NOT NULL in the DDL)
  readonly avoidsHazard: boolean;
  readonly suggestedStart?: string; // ISO-8601; nullable in the DDL
  readonly engine?: RouteEngine;
}

export interface MakeEvacRouteInput {
  readonly id: EvacRouteId;
  readonly incidentId: IncidentId;
  readonly geom: Geometry; // accept any geometry then reject non-LineString below
  readonly avoidsHazard?: boolean; // defaults to true (schema default; the point of an evac route)
  readonly suggestedStart?: string;
  readonly engine?: RouteEngine;
}

// A route must be a LineString of ≥2 positions; a Point/Polygon is not a traversable path.
function assertLineString(geom: Geometry): asserts geom is LineStringGeometry {
  if (geom.type !== 'LineString') {
    throw new InvariantViolation(`EvacRoute.geom must be a GeoJSON LineString, got ${String(geom.type)}`);
  }
  if (!Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
    throw new InvariantViolation('EvacRoute.geom LineString must have at least 2 positions');
  }
  if (!geom.coordinates.every((p) => isPosition(p))) {
    throw new InvariantViolation('EvacRoute.geom LineString positions must each be [lon,lat]');
  }
}

export function makeEvacRoute(input: MakeEvacRouteInput): EvacRoute {
  assertLineString(input.geom);
  return {
    id: input.id,
    incidentId: input.incidentId,
    geom: input.geom,
    avoidsHazard: input.avoidsHazard ?? true,
    ...(input.suggestedStart !== undefined ? { suggestedStart: input.suggestedStart } : {}),
    ...(input.engine !== undefined ? { engine: input.engine } : {}),
  };
}
