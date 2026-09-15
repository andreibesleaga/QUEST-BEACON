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

function buildBody(
  request: RouteRequest,
  avoidPolygon: Geometry | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = { coordinates: [request.from, request.to] };
  if (avoidPolygon !== undefined) body.options = { avoid_polygons: avoidPolygon };
  return body;
}

/** Build the ORS RoutingPort rung. Never throws — every failure mode returns a typed err (Art. XVI). */
export function makeOrsRoutingAdapter(deps: OrsRoutingAdapterDeps): RoutingPort {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const profile = deps.profile ?? DEFAULT_PROFILE;
  const url = `${baseUrl}/v2/directions/${profile}/geojson`;

  return {
    async route(request: RouteRequest): Promise<Result<EvacRoute, DomainError>> {
      const hazard = request.avoidHazard !== false ? deps.hazardFor(request.incidentId) : undefined;
      const avoidPolygon = hazard !== undefined && isAvoidable(hazard) ? hazard : undefined;

      let status: number;
      let httpOk: boolean;
      let json: unknown;
      try {
        const res = await deps.http.postJson(url, buildBody(request, avoidPolygon), {
          Authorization: deps.apiKey,
        });
        status = res.status;
        httpOk = res.ok;
        json = res.json;
      } catch (e) {
        return err(new DomainError('NOT_FOUND', `ORS routing unavailable: ${msg(e)}`));
      }
      if (!httpOk) return err(new DomainError('NOT_FOUND', `ORS routing HTTP ${status}`));

      const geom = parseGeometry(json);
      if (geom === null)
        return err(
          new DomainError('PARSE_ERROR', 'ORS routing: malformed/empty directions response'),
        );

      try {
        const id = asId<EvacRouteId>(deps.newId('route'));
        const route = makeEvacRoute({
          id,
          incidentId: request.incidentId,
          geom,
          avoidsHazard: avoidPolygon !== undefined,
          engine: 'ors',
          ...parseNarrative(json),
        });
        return ok(route);
      } catch (e) {
        return err(
          new DomainError('PARSE_ERROR', `ORS routing: invalid route geometry (${msg(e)})`),
        );
      }
    },
  };
}
