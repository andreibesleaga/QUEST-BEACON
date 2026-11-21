// BEACON — ORS routing adapter (E5·T-223/226 Phase-D W4a; ADR-016, FR-7, EV7). A FEATURE adapter (not a
// SourceAdapterPort/manifest row — it has no registry entry) implementing RoutingPort against
// openrouteservice.org's Directions API: POST /v2/directions/{profile}/geojson. Body/response shape verified
// against GIScience's public API V2 swagger spec (github.com/GIScience/openrouteservice-docs, "API V2/
// swagger.json" — definitions "Directions Service" §coordinates/options.avoid_polygons, "GeoJSONRouteResponse"
// §features[].geometry). Auth is a raw `Authorization: <ORS_API_KEY>` header (ORS convention — no "Bearer").
//
// Hazard-avoidance seam: RouteRequest (ports/logistics.ts) carries only incidentId/from/to/avoidHazard — NO
// geometry. This mirrors memory-routing.ts exactly: the hazard footprint is resolved via an injected
// `hazardFor(incidentId)` lookup (the composition root wires the same feature-seed hazard map into both
// rungs), then sent as `options.avoid_polygons` — but ONLY when the footprint is a Polygon/MultiPolygon (the
// only GeoJSON types ORS accepts there; a Point/LineString hazard is honestly skipped, never coerced).
//
// Typed Result, NEVER throws: any network/timeout/HTTP/parse failure returns `err(DomainError)` so
// planEvacRoute's existing `!ok` degrade to the labelled heuristic route keeps working untouched (Art. XVI).
// This adapter itself never invents a straight line — that fallback lives one layer up (planEvacRoute /
// feature-seed's ladder), exactly as the heuristic rung already does.
import { ok, err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { EvacRouteId, IncidentId } from '@/domain/value-objects/ids.js';
import type {
  Geometry,
  LineStringGeometry,
  MultiPolygonGeometry,
  PolygonGeometry,
  Position,
} from '@/domain/value-objects/geo.js';
import type { RoutingPort, RouteRequest } from '@/ports/logistics.js';
import type { HttpClient } from '@/adapters/ai/http-client.js';

const DEFAULT_BASE_URL = 'https://api.openrouteservice.org';
const DEFAULT_PROFILE = 'driving-car';

export interface OrsRoutingAdapterDeps {
  /** Injected JSON-POST client (tiny fetch wrapper, shared with the AI providers — tests inject a fake). */
  readonly http: HttpClient;
  /** ORS_API_KEY — sent as a raw Authorization header (ORS convention, no Bearer prefix). */
  readonly apiKey: string;
  /** Incident hazard-footprint lookup — same seam as memory-routing.ts's RoutingAdapterDeps.hazardFor. */
  readonly hazardFor: (incidentId: IncidentId) => Geometry | undefined;
  /** Deterministic id minter (tests inject a counter; composition injects the real minter). */
  readonly newId: (prefix: string) => string;
  readonly baseUrl?: string; // defaults to DEFAULT_BASE_URL
  readonly profile?: string; // defaults to 'driving-car'
}

const isAvoidable = (geom: Geometry): geom is PolygonGeometry | MultiPolygonGeometry =>
  geom.type === 'Polygon' || geom.type === 'MultiPolygon';

// ── Avoid areas the service will accept ───────────────────────────────────────────────────────────────
//
// The public openrouteservice API refuses an avoid polygon wider than 20 km or larger than 200 km²
// (HTTP 400, error code 2003: "The extent of a polygon to avoid must not exceed 20000.0 meters" / "The
// area … must not exceed 2.0E8 square meters"). The limit is PER POLYGON: the same area sent as several
// smaller polygons is accepted, and avoiding a set of adjacent rectangles is avoiding their union. Both
// facts were measured against the live service on 2026-11-21, when every route around a real fire fell
// back to the straight-line heuristic because the fire's bounding rectangle was 15 km × 13 km — 20.0 km
// corner to corner.
//
// So a footprint over the limit is sent as a GRID OF RECTANGLES covering its bounding rectangle. That
// over-avoids (the rectangle contains the footprint), which is the safe direction for an evacuation
// route. A footprint within the limits is sent exactly as it is, as before.
const KM_PER_DEGREE_LAT = 110.57;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;
/** Kept under the service's 20 km / 200 km² so rounding and its own geodesy cannot tip a polygon over. */
const SAFE_EXTENT_KM = 18;
const SAFE_AREA_KM2 = 180;
/** One tile: 10 km × 10 km at most — 14.1 km corner to corner, 100 km². */
const TILE_SIDE_KM = 10;
/** About 100 km × 100 km. Beyond this the request is not sent: the heuristic answers, and the log says why. */
const MAX_TILES = 100;

type Bounds = readonly [west: number, south: number, east: number, north: number];

function boundsOf(rings: readonly (readonly Position[])[]): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  }
  return [w, s, e, n];
}

function sizeKm([w, s, e, n]: Bounds): { readonly width: number; readonly height: number } {
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  return {
    width: (e - w) * KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos(midLat),
    height: (n - s) * KM_PER_DEGREE_LAT,
  };
}

function withinLimits(bounds: Bounds): boolean {
  const { width, height } = sizeKm(bounds);
  return Math.hypot(width, height) <= SAFE_EXTENT_KM && width * height <= SAFE_AREA_KM2;
}

const polygonsOf = (
  geom: PolygonGeometry | MultiPolygonGeometry,
): readonly (readonly (readonly Position[])[])[] =>
  geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

function rectangle(w: number, s: number, e: number, n: number): Position[][] {
  return [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ];
}

/**
 * The avoid area to send for a hazard footprint: the footprint itself when every polygon of it is within
 * the service's limits, a grid of rectangles over its bounding rectangle when it is not, or `null` when
 * even the grid would be unreasonably large (the caller then does not ask ORS at all).
 */
export function avoidAreaFor(
  hazard: PolygonGeometry | MultiPolygonGeometry,
): PolygonGeometry | MultiPolygonGeometry | null {
  const polygons = polygonsOf(hazard);
  if (polygons.every((rings) => withinLimits(boundsOf(rings)))) return hazard;
  const bounds = boundsOf(polygons.flat());
  const [w, s, e, n] = bounds;
  const { width, height } = sizeKm(bounds);
  const columns = Math.max(1, Math.ceil(width / TILE_SIDE_KM));
  const rows = Math.max(1, Math.ceil(height / TILE_SIDE_KM));
  if (columns * rows > MAX_TILES) return null;
  const dx = (e - w) / columns;
  const dy = (n - s) / rows;
  const tiles: Position[][][] = [];
  for (let i = 0; i < columns; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      tiles.push(rectangle(w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy));
    }
  }
  return { type: 'MultiPolygon', coordinates: tiles };
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface OrsFeature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: unknown };
}
interface OrsGeoJsonResponse {
  readonly features?: readonly OrsFeature[];
}

function toPosition(raw: unknown): Position | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [lon, lat] = raw as unknown[];
  return typeof lon === 'number' && typeof lat === 'number' ? [lon, lat] : null;
}

/** Parse the ORS GeoJSON directions response's first route into a LineStringGeometry; null on any malformed shape. */
function parseGeometry(json: unknown): LineStringGeometry | null {
  const body = json as OrsGeoJsonResponse | null;
  const geom = body?.features?.[0]?.geometry;
  if (geom?.type !== 'LineString' || !Array.isArray(geom.coordinates)) return null;
  const coordinates: Position[] = [];
  for (const raw of geom.coordinates) {
    const pos = toPosition(raw);
    if (pos === null) return null;
    coordinates.push(pos);
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

interface OrsProperties {
  readonly summary?: { readonly distance?: unknown; readonly duration?: unknown };
  readonly segments?: readonly { readonly steps?: readonly { readonly instruction?: unknown }[] }[];
}

/** The first feature's properties, or undefined when the response has none. */
function propertiesOf(json: unknown): OrsProperties | undefined {
  const feature = (
    json as { readonly features?: readonly { readonly properties?: unknown }[] } | null
  )?.features?.[0];
  const props = feature?.properties;
  return typeof props === 'object' && props !== null ? (props as OrsProperties) : undefined;
}

/** Every non-empty turn instruction, in order, across all segments. */
function instructionsOf(props: OrsProperties | undefined): readonly string[] {
  return (props?.segments ?? [])
    .flatMap((seg) => seg.steps ?? [])
    .map((st) => st.instruction)
    .filter((i): i is string => typeof i === 'string' && i.trim() !== '');
}

/** ORS's own summary (metres, seconds) and its turn instructions, verbatim; absent when the response lacks them. */
function parseNarrative(json: unknown): {
  readonly distanceM?: number;
  readonly durationSec?: number;
  readonly steps?: readonly string[];
} {
  const props = propertiesOf(json);
  const distance = props?.summary?.distance;
  const duration = props?.summary?.duration;
  const steps = instructionsOf(props);
  return {
    ...(typeof distance === 'number' ? { distanceM: distance } : {}),
    ...(typeof duration === 'number' ? { durationSec: duration } : {}),
    ...(steps.length > 0 ? { steps } : {}),
  };
}

/**
 * Why ORS refused, in words — keyed by ORS's own error code (`error.code` in its JSON error body).
 *
 * ORS's `message` is deliberately NOT forwarded: it quotes the request's coordinates, and a route origin
 * can be a person's position — it does not belong in a deploy log. The code alone names the cause, which
 * is what was missing on 2026-11-21: the log said `HTTP 400` for a key that was fine, because the public
 * service refuses a route longer than its limit whenever an area must be avoided (code 2004).
 */
const ORS_REFUSAL: Readonly<Record<number, string>> = {
  2004: 'request exceeds the service limits (with an avoid area the route may not be this long)',
  2009: 'no route found between the two points',
  2010: 'no routable road near the origin or the destination',
};

/** ` (ORS code N: reason)` for a refusal body, or '' when the body carries no numeric code. */
function refusalDetail(json: unknown): string {
  const code = (json as { readonly error?: { readonly code?: unknown } } | null)?.error?.code;
  if (typeof code !== 'number') return '';
  const reason = ORS_REFUSAL[code];
  return reason === undefined ? ` (ORS code ${code})` : ` (ORS code ${code}: ${reason})`;
}

function buildBody(
  request: RouteRequest,
  avoidPolygon: Geometry | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = { coordinates: [request.from, request.to] };
  if (avoidPolygon !== undefined) body.options = { avoid_polygons: avoidPolygon };
  return body;
}

/** ORS's error code from a refusal body, when it carries one. */
function refusalCode(json: unknown): number | undefined {
  const code = (json as { readonly error?: { readonly code?: unknown } } | null)?.error?.code;
  return typeof code === 'number' ? code : undefined;
}

/** "The request exceeds the service limits" — with an avoid area, the route is longer than ORS allows. */
const ORS_EXCEEDS_LIMITS = 2004;

// ── A route checked against the footprint, for when avoidance cannot be requested ────────────────────
//
// Two cases leave no avoid area to send: a footprint too large even for the tile grid, and a route the
// service will not compute with ANY avoid area because it is longer than about 150 km (code 2004 — the
// 2026-11-21 live case: the nearest open shelter was 181 km from a real fire). In both, ORS can still
// offer the plain road route, and whether THAT route keeps clear of the hazard is a question geometry
// answers: it is accepted only if no segment of it touches the bounding rectangle of any polygon of the
// footprint. The rectangle contains the polygon, so "clear of the rectangle" is a stronger statement
// than "clear of the hazard" — the safe direction. A route that touches it is refused, and the labelled
// heuristic answers: a road route through the hazard is never returned as a real one (Art. XVI).

/** Does the segment a→b touch the axis-aligned rectangle? (Liang–Barsky clipping, closed rectangle.) */
function segmentTouches(a: Position, b: Position, [w, s, e, n]: Bounds): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let enter = 0;
  let leave = 1;
  for (const [p, q] of [
    [-dx, a[0] - w],
    [dx, e - a[0]],
    [-dy, a[1] - s],
    [dy, n - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this edge and outside it
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

/** True when no segment of the path touches the bounding rectangle of any polygon of the hazard. */
export function routeClearOf(
  path: readonly Position[],
  hazard: PolygonGeometry | MultiPolygonGeometry,
): boolean {
  const boxes = polygonsOf(hazard).map(boundsOf);
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1] as Position;
    const to = path[i] as Position;
    if (boxes.some((box) => segmentTouches(from, to, box))) return false;
  }
  return true;
}

/** Build the ORS RoutingPort rung. Never throws — every failure mode returns a typed err (Art. XVI). */
export function makeOrsRoutingAdapter(deps: OrsRoutingAdapterDeps): RoutingPort {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const profile = deps.profile ?? DEFAULT_PROFILE;
  const url = `${baseUrl}/v2/directions/${profile}/geojson`;

  /** One request to ORS. `refused` carries ORS's own error code so the caller can act on it. */
  async function ask(
    request: RouteRequest,
    avoid: Geometry | undefined,
  ): Promise<
    | { readonly ok: true; readonly json: unknown }
    | { readonly ok: false; readonly error: DomainError; readonly code?: number }
  > {
    try {
      const res = await deps.http.postJson(url, buildBody(request, avoid), {
        Authorization: deps.apiKey,
      });
      if (res.ok) return { ok: true, json: res.json };
      const code = refusalCode(res.json);
      return {
        ok: false,
        error: new DomainError(
          'NOT_FOUND',
          `ORS routing HTTP ${res.status}${refusalDetail(res.json)}`,
        ),
        ...(code !== undefined ? { code } : {}),
      };
    } catch (e) {
      return {
        ok: false,
        error: new DomainError('NOT_FOUND', `ORS routing unavailable: ${msg(e)}`),
      };
    }
  }

  /** ORS's answer as a route, or a typed error for a body that is not one. */
  function toRoute(
    json: unknown,
    request: RouteRequest,
    geom: LineStringGeometry,
    avoidsHazard: boolean,
  ): Result<EvacRoute, DomainError> {
    try {
      return ok(
        makeEvacRoute({
          id: asId<EvacRouteId>(deps.newId('route')),
          incidentId: request.incidentId,
          geom,
          avoidsHazard,
          engine: 'ors',
          ...parseNarrative(json),
        }),
      );
    } catch (e) {
      return err(new DomainError('PARSE_ERROR', `ORS routing: invalid route geometry (${msg(e)})`));
    }
  }

  const malformed = (): Result<EvacRoute, DomainError> =>
    err(new DomainError('PARSE_ERROR', 'ORS routing: malformed/empty directions response'));

  /** The plain road route, accepted only when it is clear of the footprint (see `routeClearOf`). */
  async function verifiedPlainRoute(
    request: RouteRequest,
    hazard: PolygonGeometry | MultiPolygonGeometry,
  ): Promise<Result<EvacRoute, DomainError>> {
    const plain = await ask(request, undefined);
    if (!plain.ok) return err(plain.error);
    const geom = parseGeometry(plain.json);
    if (geom === null) return malformed();
    if (!routeClearOf(geom.coordinates, hazard))
      return err(
        new DomainError(
          'NOT_FOUND',
          'ORS routing: the road route offered passes through the hazard footprint',
        ),
      );
    return toRoute(plain.json, request, geom, true);
  }

  /** The polygon footprint to keep clear of, or nothing: avoidance declined, no footprint, or not an area. */
  function hazardOf(request: RouteRequest): PolygonGeometry | MultiPolygonGeometry | undefined {
    if (request.avoidHazard === false) return undefined;
    const found = deps.hazardFor(request.incidentId);
    return found !== undefined && isAvoidable(found) ? found : undefined;
  }

  /** No footprint in play: the plain road route, reported as not avoiding anything. */
  async function plainRoute(request: RouteRequest): Promise<Result<EvacRoute, DomainError>> {
    const answer = await ask(request, undefined);
    if (!answer.ok) return err(answer.error);
    const geom = parseGeometry(answer.json);
    return geom === null ? malformed() : toRoute(answer.json, request, geom, false);
  }

  return {
    async route(request: RouteRequest): Promise<Result<EvacRoute, DomainError>> {
      const hazard = hazardOf(request);
      if (hazard === undefined) return plainRoute(request);
      const avoidArea = avoidAreaFor(hazard);
      // A footprint too large even for the tile grid: avoidance cannot be requested, only checked.
      if (avoidArea === null) return verifiedPlainRoute(request, hazard);

      const first = await ask(request, avoidArea);
      // Too long for ANY avoid area: ask for the plain route and check it against the footprint.
      if (!first.ok && first.code === ORS_EXCEEDS_LIMITS)
        return verifiedPlainRoute(request, hazard);
      if (!first.ok) return err(first.error);
      const geom = parseGeometry(first.json);
      return geom === null ? malformed() : toRoute(first.json, request, geom, true);
    },
  };
}
