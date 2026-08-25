// BEACON — in-memory RoutingPort adapter (E5·T-223/226; FR-7, EV7, ADR-016, SPEC §5.5). The DEFAULT,
// air-gapped rung of the routing ladder (ORS → Valhalla/OSRM → THIS heuristic): a deterministic,
// hazard-avoiding straight-line router. If the direct from→to segment intersects the incident hazard
// footprint (buffered via the SpatialPort/Turf), it detours around the buffer; it NEVER dead-ends
// (Art. XVI) — an un-clearable hazard degrades to a labelled straight line (avoids_hazard=false).
// No network. Adapters may import @/domain,@/ports,@/adapters/spatial (hexagonal boundary).
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { EvacRouteId, IncidentId } from '@/domain/value-objects/ids.js';
import type { Geometry, LineStringGeometry, Position } from '@/domain/value-objects/geo.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { RoutingPort, RouteRequest } from '@/ports/logistics.js';

/** Safety margin (metres) buffered around the hazard the route must clear (SPEC §5.5). */
const DEFAULT_HAZARD_BUFFER_METERS = 250;
/** Perpendicular-offset detour attempts before conceding to a labelled straight line (Art. XVI). */
const MAX_DETOUR_STEPS = 8;

export interface RoutingAdapterDeps {
  /** Deterministic geometry math (Turf.js by default) — every number comes from HERE, never an LLM (Art. XII). */
  readonly spatial: SpatialPort;
  /** Incident hazard-footprint lookup. Absent ⇒ nothing to avoid (route is a plain straight line). */
  readonly hazardFor: (incidentId: IncidentId) => Geometry | undefined;
  /** Deterministic id minter (tests inject a counter; the composition root injects the real minter). */
  readonly newId: (prefix: string) => string;
  /** Buffer (metres) enforced around the hazard; defaults to DEFAULT_HAZARD_BUFFER_METERS. */
  readonly bufferMeters?: number;
}

const line = (coordinates: readonly Position[]): LineStringGeometry => ({ type: 'LineString', coordinates });

const midpoint = (from: Position, to: Position): Position => [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];

/** Unit-ish perpendicular to from→to in lon/lat space (heuristic detour direction, not geodesic). */
function perpendicular(from: Position, to: Position): Position {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/** A candidate 3-point detour: the segment midpoint pushed `mag` along ±perpendicular. */
function detourVia(from: Position, to: Position, perp: Position, mag: number): LineStringGeometry {
  const m = midpoint(from, to);
  const via: Position = [m[0] + perp[0] * mag, m[1] + perp[1] * mag];
  return line([from, via, to]);
}

/** True when `geom` provably does NOT intersect the obstacle (deterministic, via the SpatialPort). */
function clears(spatial: SpatialPort, geom: LineStringGeometry, obstacle: Geometry): boolean {
  const r = spatial.intersect(geom, obstacle);
  return r.ok && r.value === false;
}

/** Search perpendicular detours (both sides, growing magnitude) for one that clears `obstacle`. */
function routeAround(from: Position, to: Position, obstacle: Geometry, spatial: SpatialPort): LineStringGeometry | null {
  const perp = perpendicular(from, to);
  const segLen = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  for (let step = 1; step <= MAX_DETOUR_STEPS; step++) {
    const mag = segLen * 0.5 * step;
    for (const side of [1, -1] as const) {
      const candidate = detourVia(from, to, perp, mag * side);
      if (clears(spatial, candidate, obstacle)) return candidate;
    }
  }
  return null;
}

/** Build a hazard-avoiding route around the buffered footprint; degrade to a labelled straight line (Art. XVI). */
function avoidHazard(
  id: EvacRouteId,
  request: RouteRequest,
  straight: LineStringGeometry,
  hazard: Geometry,
  deps: RoutingAdapterDeps,
  bufferMeters: number,
): EvacRoute {
  const buffered = deps.spatial.buffer(hazard, bufferMeters);
  const obstacle: Geometry = buffered.ok ? buffered.value : hazard;
  const build = (geom: LineStringGeometry, avoidsHazard: boolean): EvacRoute =>
    makeEvacRoute({ id, incidentId: request.incidentId, geom, avoidsHazard, engine: 'heuristic' });

  if (clears(deps.spatial, straight, obstacle)) return build(straight, true);
  const detour = routeAround(request.from, request.to, obstacle, deps.spatial);
  return detour !== null ? build(detour, true) : build(straight, false);
}

/** Plan one route. Never errs (Art. XVI): the worst case is a straight line labelled avoids_hazard=false. */
function plan(request: RouteRequest, deps: RoutingAdapterDeps, bufferMeters: number): Result<EvacRoute, DomainError> {
  const id = asId<EvacRouteId>(deps.newId('route'));
  const straight = line([request.from, request.to]);
  const hazard = request.avoidHazard !== false ? deps.hazardFor(request.incidentId) : undefined;
  if (hazard === undefined) {
    // No footprint to check against ⇒ we cannot CLAIM avoidance (honest label): avoids_hazard=false.
    return ok(makeEvacRoute({ id, incidentId: request.incidentId, geom: straight, avoidsHazard: false, engine: 'heuristic' }));
  }
  return ok(avoidHazard(id, request, straight, hazard, deps, bufferMeters));
}

/** Build the in-memory, hazard-avoiding RoutingPort. Pure over its injected deps → fully deterministic. */
export function makeRoutingAdapter(deps: RoutingAdapterDeps): RoutingPort {
  const bufferMeters = deps.bufferMeters ?? DEFAULT_HAZARD_BUFFER_METERS;
  return { route: (request) => Promise.resolve(plan(request, deps, bufferMeters)) };
}
