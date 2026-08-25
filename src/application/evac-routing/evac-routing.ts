// BEACON — evacuation routing use-case (E5·T-223/T-226/T-227; FR-7, ADR-016, SPEC §5.5/§5.7).
// Drives the RoutingPort ladder; on any routing failure it degrades to a labeled straight-line
// heuristic (avoids_hazard=false) — NEVER a dead-end (Art. XVI). Imports the RoutingPort only.
import type { RoutingPort, RouteRequest } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { EvacRouteId } from '@/domain/value-objects/ids.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { LineStringGeometry, Position } from '@/domain/value-objects/geo.js';
import { ok } from '@/domain/shared/result.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import { DEFAULT_EVAC_SAFETY_MARGIN_SEC, DEFAULT_EVAC_SPEED_MPS } from '@/application/shared/config.js';

export type RouteQuality = 'ROUTED' | 'HEURISTIC';

export interface EvacRoutePlan {
  readonly route: EvacRoute;
  readonly quality: RouteQuality; // ROUTED (engine) vs HEURISTIC (approximate straight-line)
  readonly label: string; // human-readable degradation/quality label
}

export interface EvacRoutingInput {
  readonly request: RouteRequest;
  readonly heuristicRouteId: EvacRouteId; // id used only if we must build the fallback route
  readonly suggestedStart?: string; // optional precomputed suggested-start (ISO-8601)
}

/**
 * Plan an evacuation route. Success ⇒ the engine route (avoids_hazard as the router determined).
 * Failure ⇒ a straight-line from→to with avoids_hazard=false, clearly labeled "approximate" (Art. XVI).
 */
export async function planEvacRoute(input: EvacRoutingInput, routing: RoutingPort): Promise<Result<EvacRoutePlan, DomainError>> {
  const routed = await routing.route(input.request);
  if (routed.ok) {
    return ok({ route: withStart(routed.value, input.suggestedStart), quality: 'ROUTED', label: 'engine route' });
  }
  const heuristic = makeEvacRoute({
    id: input.heuristicRouteId,
    incidentId: input.request.incidentId,
    geom: { type: 'LineString', coordinates: [input.request.from, input.request.to] },
    avoidsHazard: false,
    engine: 'heuristic',
    ...(input.suggestedStart !== undefined ? { suggestedStart: input.suggestedStart } : {}),
  });
  return ok({ route: heuristic, quality: 'HEURISTIC', label: 'approximate straight-line (routing unavailable)' });
}

function withStart(route: EvacRoute, suggestedStart: string | undefined): EvacRoute {
  if (suggestedStart === undefined || route.suggestedStart !== undefined) return route;
  return { ...route, suggestedStart };
}

export interface SuggestedStartInput {
  readonly projectedHazardArrival?: string; // ISO-8601; null/undefined ⇒ no suggested start
  readonly routeClearanceSec: number; // deterministic travel/clearance estimate
  readonly safetyMarginSec?: number; // config buffer (default EVAC_SAFETY_MARGIN_SEC)
}

/**
 * Deterministic suggested evacuation start (SPEC §5.7):
 * suggested_start = projected_hazard_arrival − route_clearance_time − safety_margin.
 * Unknown arrival ⇒ null (route returned without a suggested start; never a dead-end, Art. XVI).
 */
export function computeSuggestedStart(input: SuggestedStartInput): string | null {
  if (input.projectedHazardArrival === undefined) return null;
  const arrivalMs = Date.parse(input.projectedHazardArrival);
  if (Number.isNaN(arrivalMs)) return null;
  const margin = input.safetyMarginSec ?? DEFAULT_EVAC_SAFETY_MARGIN_SEC;
  const startMs = arrivalMs - (input.routeClearanceSec + margin) * 1000;
  return new Date(startMs).toISOString();
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance (metres) between two [lon,lat] positions — deterministic (Art. XII, no LLM). */
function haversineMeters(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total great-circle length (metres) of a LineString path — the sum of its segment distances. */
export function pathLengthMeters(coordinates: readonly Position[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) total += haversineMeters(coordinates[i - 1]!, coordinates[i]!);
  return total;
}

/**
 * Deterministic route-clearance estimate (seconds) to traverse a routed path at a given evac speed
 * (SPEC §5.7). A longer path (e.g. a hazard detour) yields a larger clearance ⇒ an earlier suggested start.
 * A non-positive speed falls back to the configured default (never divides by zero — Art. XVI).
 */
export function routeClearanceSeconds(geom: LineStringGeometry, metersPerSecond = DEFAULT_EVAC_SPEED_MPS): number {
  const speed = metersPerSecond > 0 ? metersPerSecond : DEFAULT_EVAC_SPEED_MPS;
  return pathLengthMeters(geom.coordinates) / speed;
}
