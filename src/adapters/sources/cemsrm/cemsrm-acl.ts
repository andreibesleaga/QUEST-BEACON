// BEACON — Copernicus EMS Rapid Mapping anti-corruption layer (S2·Lane-A2; adapter-contract §4,
// F1/Art. XII). Maps one CEMS Rapid Mapping ACTIVATION record → a canonical HazardGeometry (activation
// CENTROID). This is the ONLY place the raw CEMS JSON shape exists; no CEMS field name escapes above
// this module (AGENTS.md §3). Geometry/instants are produced deterministically here — never by the LLM.
//
// VERIFIED LIVE (2026-08-08, real curl, HTTP 200, KEYLESS — recorded verbatim into
// `__fixtures__/activations.json`):
//   GET https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=20
//   → { count, next, previous, results: [ { code, name, countries[], category, eventTime, activationTime,
//       lastUpdate, closed, centroid: "POINT (<lon> <lat>)", gdacsId, n_aois, n_products } ] }
//   The sibling detail route `…/public-activations/?code=EMSR758` was also probed live (HTTP 200) and
//   returns the Romania Galati/Vaslui flood activation with its AOI polygons — it is deliberately NOT
//   consumed here (see the AOI note below).
//
// SCOPE (mirrors gdacs-acl.ts / eonet-acl.ts — BEACON covers wildfire + flood): only `Wildfire` and
// `Flood` activations are kept. Storm / Earthquake / Volcanic activity / Other are DROPPED **and
// COUNTED** at parse time — lenient by directive, never silently unaccounted for.
//
// WHY THE CENTROID AND NOT THE AOI (binding, the F-06/F-48 failure class): a CEMS "Area of Interest" is
// the rectangle the RESPONDERS ASKED TO HAVE MAPPED, not the observed flood/burn extent. Rendering an
// AOI as a hazard footprint would paint a tasking box as an impact area and feed it to exposure
// computation — an engine number derived from the wrong semantic input is still an invented number
// (Art. XII). So this ACL emits ONE activation-centroid Point per activation, `live-seed.ts` keeps
// `cemsrm` out of HAZARD_FOOTPRINT_SOURCES, and the delineation/grading PRODUCTS (the real extents) stay
// a documented roadmap item behind the detail route.
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// CEMS activations are not yet correlated to a BEACON incident; a stable sentinel keeps provenance
// intact without inventing a fake incident id (same convention as firms/gdacs/eonet).
const UNASSIGNED_INCIDENT = asId<IncidentId>('cemsrm-unassigned');

/** In-scope CEMS `category` → domain HazardGeometry.kind. Anything else is dropped + counted. */
const KIND_BY_CATEGORY: Readonly<Record<string, 'HOTSPOT' | 'FLOOD_REACH'>> = {
  Wildfire: 'HOTSPOT',
  Flood: 'FLOOD_REACH',
};

/** One raw CEMS Rapid Mapping activation (unknown fields ignored — lenient by directive). */
export interface CemsActivation {
  readonly code?: string;
  readonly name?: string;
  readonly category?: string;
  readonly countries?: readonly string[];
  readonly eventTime?: string;
  readonly activationTime?: string;
  readonly lastUpdate?: string;
  readonly closed?: boolean;
  readonly centroid?: string; // WKT, e.g. "POINT (-6.6928 37.4797)"
  readonly gdacsId?: string | null;
}

/** Lenient parse result: in-scope activations + the count dropped as out-of-scope/unusable. */
export interface CemsParseResult {
  readonly activations: readonly CemsActivation[];
  readonly skipped: number;
}

/**
 * Parse a CEMS `public-activations-info` page, keeping ONLY in-scope (wildfire/flood) activations that
 * carry a usable code and a parseable WKT centroid. Every other row is dropped AND counted, so "we saw
 * 20 activations and used 19" is always answerable.
 */
export function parseCemsActivations(text: string): CemsParseResult {
  const doc = JSON.parse(text) as { results?: readonly CemsActivation[] };
  const all = Array.isArray(doc.results) ? doc.results : [];
  const activations = all.filter(isUsable);
  return { activations, skipped: all.length - activations.length };
}

function isUsable(row: CemsActivation): boolean {
  return (
    KIND_BY_CATEGORY[row.category ?? ''] !== undefined &&
    typeof row.code === 'string' &&
    row.code !== '' &&
    parseWktPoint(row.centroid) !== undefined
  );
}

/**
 * Parse the CEMS WKT centroid `POINT (<lon> <lat>)` — WKT axis order is (x y) = (lon lat), which is
 * ALREADY GeoJSON order, so nothing is swapped here (contrast wmo-swic's CAP `lat,lon`). Returns
 * undefined for any other WKT type or a non-finite pair; geometry is never fabricated (Art. XVI).
 */
export function parseWktPoint(wkt: string | undefined): readonly [number, number] | undefined {
  const m = /^\s*POINT\s*\(\s*(\S+)\s+(\S+)\s*\)\s*$/i.exec(wkt ?? '');
  if (m === null) return undefined;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : undefined;
}

export const cemsMapper: AntiCorruptionMapper<CemsActivation, HazardGeometry> = {
  toCanonical(raw: CemsActivation, ctx: MapContext): HazardGeometry {
    const kind = KIND_BY_CATEGORY[raw.category ?? ''];
    const point = parseWktPoint(raw.centroid);
    if (kind === undefined || point === undefined) {
      // parseCemsActivations already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine).
      throw makeAdapterError(
        'PARSE',
        `CEMS activation '${raw.code ?? '?'}' has an out-of-scope category or unparseable centroid`,
      );
    }
    return makeHazardGeometry({
      id: asId<HazardGeometryId>(`cemsrm:${raw.code}`),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind,
      geometry: { type: 'Point', coordinates: point },
      observedAt: cemsObservedAt(raw, ctx.fetchedAt),
    });
    // No `intensity`: CEMS activation metadata publishes no magnitude figure, and inventing one (from
    // n_products, say) would be a fabricated number (Art. XII).
  },
};

/**
 * CEMS timestamps are second-resolution ISO with NO zone designator (observed live: "2026-08-06T10:00:00").
 * The service publishes them as UTC, so an explicit `Z` is appended rather than letting the runtime apply
 * the SERVER's local zone — a silent local-time reading would shift every event by the host's offset.
 * `eventTime` (when the disaster happened) is the honest observation anchor; `activationTime` (when the
 * mapping service was triggered) is later and is deliberately not used as the freshness anchor.
 */
export function cemsObservedAt(raw: CemsActivation, fallback: string): string {
  const t = (raw.eventTime ?? '').trim();
  if (t === '') return fallback;
  const iso = /(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : `${t}Z`;
  return Number.isNaN(Date.parse(iso)) ? fallback : iso;
}
