// BEACON — NIFC anti-corruption layer (E4·T-17x; adapter-contract §4, DATA_SOURCE_VERIFICATION §1/Art.
// XII). Maps a NIFC/WFIGS "Interagency Perimeters Current" GeoJSON feature → a canonical HazardGeometry
// (kind PERIMETER). This is the ONLY place the raw ArcGIS/GeoJSON shape exists; no `poly_*` field name
// escapes above this module (AGENTS.md §3). Geometry is produced deterministically here — never the LLM.
//
// Closes the "FIRMS ≠ perimeters" honest limitation (DATA_SOURCE_VERIFICATION §1): FIRMS gives thermal
// hotspots (satellite detections), NIFC/WFIGS gives the official interagency-drawn burn-boundary polygon.
// A feature whose geometry is missing/not Polygon|MultiPolygon/structurally invalid is SKIPPED (not
// thrown) at parse time and counted — one bad perimeter in a batch of hundreds must not blank the whole
// layer (Art. XVI, never dead-end the COP). The mapper itself still throws a defensive PARSE if it is
// ever called directly with a shape parseNifcFeatures would have rejected.
import type { Geometry, HazardGeometry, HazardGeometryId, IncidentId, Position, SourceId } from '@/domain/index.js';
import { asId, isPosition, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// NIFC perimeters are not yet correlated to a BEACON incident; correlation happens downstream. A stable
// sentinel keeps provenance intact without inventing a fake incident id (mirrors firms/gdacs).
const UNASSIGNED_INCIDENT = asId<IncidentId>('nifc-unassigned');

interface NifcProps {
  readonly poly_IncidentName?: string | null;
  readonly poly_DateCurrent?: number | null; // epoch millis (ArcGIS convention)
}

interface NifcGeometry {
  readonly type?: string;
  readonly coordinates?: unknown;
}

/** One raw NIFC/WFIGS GeoJSON feature (Polygon or MultiPolygon perimeter). Raw until mapped. */
export interface NifcFeature {
  readonly type?: string;
  readonly geometry?: NifcGeometry | null;
  readonly properties?: NifcProps | null;
}

export interface ParsedNifcFeatures {
  readonly features: readonly NifcFeature[];
  readonly skipped: number; // count of malformed features dropped at parse (never silently unaccounted)
}

/**
 * Parse a WFIGS_Interagency_Perimeters_Current GeoJSON FeatureCollection, keeping only features whose
 * geometry is a structurally valid Polygon/MultiPolygon. Malformed features are skipped and counted
 * rather than aborting the whole fetch (one bad perimeter must not blank the layer).
 */
export function parseNifcFeatures(text: string): ParsedNifcFeatures {
  const doc = JSON.parse(text) as { features?: NifcFeature[] };
  const all = Array.isArray(doc.features) ? doc.features : [];
  const features = all.filter(hasValidGeometry);
  return { features, skipped: all.length - features.length };
}

export const nifcMapper: AntiCorruptionMapper<NifcFeature, HazardGeometry> = {
  toCanonical(raw: NifcFeature, ctx: MapContext): HazardGeometry {
    if (!hasValidGeometry(raw)) {
      throw makeAdapterError('PARSE', `NIFC feature missing/invalid Polygon|MultiPolygon geometry`);
    }
    const props: NifcProps = raw.properties ?? {};
    return makeHazardGeometry({
      id: perimeterId(props, raw.geometry),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind: 'PERIMETER',
      // Geometry is kept EXACTLY as upstream serves it — no simplification (honesty: a simplified
      // burn boundary would misrepresent the official perimeter).
      geometry: toCanonicalGeometry(raw.geometry as NifcGeometry),
      observedAt: toIsoUtc(props.poly_DateCurrent, ctx.fetchedAt),
    });
  },
};

function toCanonicalGeometry(geom: NifcGeometry): Geometry {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates as readonly (readonly Position[])[] };
  }
  return { type: 'MultiPolygon', coordinates: geom.coordinates as readonly (readonly (readonly Position[])[])[] };
}

function hasValidGeometry(f: NifcFeature): boolean {
  const g = f.geometry;
  if (g == null) return false;
  if (g.type === 'Polygon') return isValidPolygonCoords(g.coordinates);
  if (g.type === 'MultiPolygon') return isValidMultiPolygonCoords(g.coordinates);
  return false;
}

function isValidRing(ring: unknown): ring is Position[] {
  return Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition);
}

function isValidPolygonCoords(c: unknown): c is Position[][] {
  return Array.isArray(c) && c.length > 0 && c.every(isValidRing);
}

function isValidMultiPolygonCoords(c: unknown): c is Position[][][] {
  return Array.isArray(c) && c.length > 0 && c.every(isValidPolygonCoords);
}

/** Stable id from the incident name + currency timestamp (deterministic, dedup-friendly, no hidden LLM). */
function perimeterId(props: NifcProps, geom: NifcGeometry | null | undefined): HazardGeometryId {
  const name = props.poly_IncidentName ?? 'unnamed';
  const date = props.poly_DateCurrent ?? 'x';
  const anchor = firstCoordinate(geom);
  return asId<HazardGeometryId>(`nifc:${name}:${date}:${anchor}`);
}

/** First vertex of the geometry, used only to disambiguate an id when name+date collide (defensive). */
function firstCoordinate(geom: NifcGeometry | null | undefined): string {
  const c = geom?.coordinates;
  if (!Array.isArray(c)) return '0,0';
  // Polygon: coords[0][0] is a Position; MultiPolygon: coords[0][0][0] is a Position.
  const candidate = Array.isArray(c[0]) && isPosition(c[0]) ? c[0] : (c[0] as unknown[])?.[0];
  return isPosition(candidate) ? `${candidate[0]},${candidate[1]}` : '0,0';
}

/** NIFC `poly_DateCurrent` is epoch millis (ArcGIS convention); normalize to ISO-8601 UTC. */
export function toIsoUtc(epochMs: number | null | undefined, fallback: string): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return fallback;
  const iso = new Date(epochMs).toISOString();
  return Number.isNaN(Date.parse(iso)) ? fallback : iso;
}
