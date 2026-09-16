// BEACON — FEMA National Risk Index anti-corruption layer (S2·Lane-A2; adapter-contract §4,
// PopulationPort P12, Art. XII). Maps one NRI county feature → a canonical PopulationEstimate. This is
// the ONLY place the raw ArcGIS FeatureServer shape exists (AGENTS.md §3). Lenient by directive: unknown
// fields ignored, malformed features dropped AND counted.
//
// VERIFIED LIVE (2026-08-08, real curl, HTTP 200, KEYLESS — recorded verbatim into
// `__fixtures__/counties.json`):
//   GET https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/
//       National_Risk_Index_Counties/FeatureServer/0/query
//       ?where=1=1&outFields=…&geometry=-121.9,39.4,-121.35,39.85&geometryType=esriGeometryEnvelope
//       &inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&returnCentroid=true
//       &outSR=4326&f=json
//   → { fields: [...], features: [ { attributes: { NRI_ID, STATE, STATEABBRV, COUNTY, STCOFIPS,
//       POPULATION, BUILDVALUE, RISK_SCORE, RISK_RATNG, WFIR_RISKS, WFIR_RISKR }, centroid: {x,y} } ] }
//   (returned Butte / Glenn / Plumas / Yuba counties for the Butte-fire demo envelope).
//
// 🔴 WHAT IS EMITTED, AND WHAT DELIBERATELY IS NOT (read this before assuming the row is misnamed): the
// NRI table's `POPULATION` column is the county's 2020 Decennial Census population, carried VERBATIM —
// that is a real, exact, citable figure and it is what this adapter emits, on the `Population` port,
// alongside `census` (CA-scoped) and `worldpop` (modeled). The NRI RISK INDICES (`RISK_SCORE`,
// `RISK_RATNG`, `WFIR_RISKS`, …) are requested and parsed into the raw row so the recorded fixture is a
// truthful NRI sample and a future risk-context layer needs no re-verification — but they are NOT
// emitted as any domain entity today, because BEACON has NO risk-context port and inventing one is out
// of this lane's scope. An unrouted claim is worse than an absent one (Art. XVI), so the limitation is
// stated here, in NOTICE and in the audit row rather than smuggled into a plausible-looking entity.
//
// GRANULARITY (honest, and the same shape `OutageRecord` already documents for EAGLE-I): the NRI is a
// COUNTY table. Each estimate's `area` is therefore a small box centred on the county's own
// service-supplied centroid — a centroid MARKER, not the county's boundary. Nothing here claims a
// per-bbox clipped population; the adapter's `estimatePopulation` sums whole counties whose centroid
// falls inside the query bbox and says so.
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/**
 * Half-edge (degrees) of the marker box drawn around a county centroid. Small and deliberate: it makes
 * the estimate's `area` a POINT MARKER with a tiny footprint, never a pretend county boundary.
 */
const CENTROID_BOX_DEG = 0.01;

/** The NRI attributes this adapter requests, carried verbatim (unknown fields ignored — lenient). */
export interface NriAttributes {
  readonly NRI_ID?: string;
  readonly STATE?: string;
  readonly STATEABBRV?: string;
  readonly COUNTY?: string;
  readonly COUNTYTYPE?: string;
  readonly STCOFIPS?: string;
  readonly POPULATION?: number | null;
  readonly BUILDVALUE?: number | null;
  // Parsed but NOT emitted — see the 🔴 note in this file's header.
  readonly RISK_SCORE?: number | null;
  readonly RISK_RATNG?: string | null;
  readonly WFIR_RISKS?: number | null;
  readonly WFIR_RISKR?: string | null;
}

/** One raw NRI county feature (centroid-only: the adapter never requests the polygon geometry). */
export interface NriFeature {
  readonly attributes?: NriAttributes;
  readonly centroid?: { readonly x?: number; readonly y?: number } | null;
}

/** Lenient parse result: usable county features + the count dropped as unusable. */
export interface NriParseResult {
  readonly features: readonly NriFeature[];
  readonly skipped: number;
}

interface NriResponse {
  readonly features?: readonly NriFeature[];
  readonly error?: { readonly code?: number; readonly message?: string };
}

/**
 * Parse an ArcGIS FeatureServer `query` response. ArcGIS answers HTTP 200 even for a rejected query
 * (`{"error":{...}}`), so that shape is raised as a typed PARSE here rather than degrading silently to
 * "this area has no population" — a zero that came from a malformed query is the worst kind of number
 * (Art. XII). A feature with no finite centroid or no finite POPULATION is dropped AND counted.
 */
export function parseNriCounties(text: string): NriParseResult {
  const doc = JSON.parse(text) as NriResponse;
  if (doc.error !== undefined) {
    throw makeAdapterError(
      'PARSE',
      `FEMA NRI query error ${doc.error.code ?? '?'}: ${doc.error.message ?? '?'}`,
    );
  }
  const all = Array.isArray(doc.features) ? doc.features : [];
  const features = all.filter(isUsable);
  return { features, skipped: all.length - features.length };
}

function isUsable(feature: NriFeature): boolean {
  const population = feature.attributes?.POPULATION;
  return (
    centroidOf(feature) !== undefined &&
    typeof population === 'number' &&
    Number.isFinite(population) &&
    population >= 0
  );
}

/** The service-supplied county centroid as `[lon, lat]` (WGS-84, `outSR=4326`), or undefined. */
export function centroidOf(feature: NriFeature): readonly [number, number] | undefined {
  const x = feature.centroid?.x;
  const y = feature.centroid?.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
    return undefined;
  return [x, y];
}

export const nriMapper: AntiCorruptionMapper<NriFeature, PopulationEstimate> = {
  toCanonical(raw: NriFeature): PopulationEstimate {
    const centroid = centroidOf(raw);
    const population = raw.attributes?.POPULATION;
    if (centroid === undefined || typeof population !== 'number' || !Number.isFinite(population)) {
      // parseNriCounties already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine).
      throw makeAdapterError(
        'PARSE',
        `FEMA NRI feature '${raw.attributes?.NRI_ID ?? '?'}' has no usable centroid/POPULATION`,
      );
    }
    // POPULATION is an exact integer census count in the NRI table — it is carried VERBATIM, never
    // rounded, scaled or interpolated (Art. XII).
    return { area: centroidBox(centroid), count: population };
  },
};

/** A tiny marker box around a county centroid (see CENTROID_BOX_DEG — never a pretend boundary). */
export function centroidBox([lon, lat]: readonly [number, number]): BBox {
  return [
    lon - CENTROID_BOX_DEG,
    lat - CENTROID_BOX_DEG,
    lon + CENTROID_BOX_DEG,
    lat + CENTROID_BOX_DEG,
  ];
}

/** Centre point of a BBox (recovers a county centroid from a stored estimate's marker area). */
export function bboxCenter(bbox: BBox): readonly [lon: number, lat: number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Point-in-bbox membership test (inclusive bounds), used to scope county estimates to a query bbox. */
export function pointInBBox(point: readonly [lon: number, lat: number], bbox: BBox): boolean {
  const [lon, lat] = point;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}
