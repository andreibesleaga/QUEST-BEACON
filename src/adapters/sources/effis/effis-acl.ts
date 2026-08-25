// BEACON — EFFIS/GWIS anti-corruption layer (E4·Part-B; adapter-contract §4, F1/Art. XII). Maps one
// Copernicus EFFIS/GWIS GeoJSON feature → a canonical HazardGeometry. This is the ONLY place the raw
// EFFIS/GWIS feature shape exists; no raw field name escapes above this module (AGENTS.md §3). Geometry
// is produced deterministically here — never the LLM.
//
// Scope: the EFFIS/GWIS "current situation" feed mixes two product types in one FeatureCollection —
// MODIS/Sentinel burnt-area polygons (Polygon/MultiPolygon) and active-fire detections (Point). Kind is
// derived from the GeoJSON geometry.type itself (not a property field), matching how the upstream
// service actually distinguishes the two products. Honest limitation: this is the EU/global NON-US
// equivalent of NIFC/FIRMS (DATA_SOURCE_VERIFICATION §1) — burnt-area polygons are retrospective (mapped
// after the fact, not a live-fire perimeter), and active-fire points are coarse detections like FIRMS
// hotspots, not authoritative boundaries.
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// EFFIS/GWIS features are not yet correlated to a BEACON incident; a stable sentinel keeps provenance
// intact without inventing a fake incident id (mirrors gdacs-acl.ts / firms-acl.ts).
const UNASSIGNED_INCIDENT = asId<IncidentId>('effis-unassigned');

// In-scope GeoJSON geometry.type -> domain HazardGeometry.kind. Polygon/MultiPolygon = burnt-area
// perimeter/extent; Point = active-fire hotspot. Reuses the SAME enum members firms (HOTSPOT) and the
// seeded CA fire perimeter in src/main/scenario-inputs.ts (PERIMETER) already use — no new kind invented.
const KIND_BY_GEOM_TYPE: Record<string, 'PERIMETER' | 'HOTSPOT'> = {
  Polygon: 'PERIMETER',
  MultiPolygon: 'PERIMETER',
  Point: 'HOTSPOT',
};

interface EffisProps {
  readonly id?: number | string;
  readonly firedate?: string;
  readonly lastupdate?: string;
  readonly country?: string;
  readonly area_ha?: number;
  readonly place?: string;
}

interface EffisGeometry {
  readonly type?: string;
  // Point: [lon,lat]. Polygon: [ring][pos][lon,lat]. MultiPolygon: [poly][ring][pos][lon,lat].
  readonly coordinates?: unknown;
}

/** One raw EFFIS/GWIS feature (Point active-fire OR Polygon/MultiPolygon burnt area). Raw until mapped. */
export interface EffisFeature {
  readonly geometry?: EffisGeometry | null;
  readonly properties?: EffisProps | null;
}

/**
 * Parse an EFFIS/GWIS GeoJSON FeatureCollection, keeping only features with an in-scope geometry type
 * (Point/Polygon/MultiPolygon) and structurally sane coordinates. Malformed features (missing/unknown
 * geometry, empty/short coordinate arrays) are SKIPPED here — never thrown into the mapper — so one bad
 * upstream row can't fail the whole fetch (adapter-contract §3.1); callers can diff input vs output
 * feature counts to see how many were skipped.
 */
export function parseEffisFeatures(text: string): EffisFeature[] {
  const doc = JSON.parse(text) as { features?: EffisFeature[] };
  const features = Array.isArray(doc.features) ? doc.features : [];
  return features.filter((f) => isStructurallySane(f.geometry));
}

function isStructurallySane(geom: EffisGeometry | null | undefined): boolean {
  const type = geom?.type ?? '';
  if (!(type in KIND_BY_GEOM_TYPE)) return false;
  if (type === 'Point') return isPosition(geom?.coordinates);
  if (type === 'Polygon') return isPolygonCoords(geom?.coordinates);
  return isMultiPolygonCoords(geom?.coordinates); // MultiPolygon: array of Polygon coordinate arrays
}

/** A GeoJSON Position: exactly [lon, lat], both finite numbers. */
function isPosition(v: unknown): v is readonly [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** A closed ring needs >=4 positions (first === last); this is a structural (not closure) check. */
function isRing(v: unknown): v is readonly (readonly [number, number])[] {
  return Array.isArray(v) && v.length >= 4 && v.every(isPosition);
}

function isPolygonCoords(v: unknown): v is readonly (readonly (readonly [number, number])[])[] {
  return Array.isArray(v) && v.length > 0 && v.every(isRing);
}

function isMultiPolygonCoords(
  v: unknown,
): v is readonly (readonly (readonly (readonly [number, number])[])[])[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPolygonCoords);
}

export const effisMapper: AntiCorruptionMapper<EffisFeature, HazardGeometry> = {
  toCanonical(raw: EffisFeature, ctx: MapContext): HazardGeometry {
    const props: EffisProps = raw.properties ?? {};
    const type = raw.geometry?.type ?? '';
    const kind = KIND_BY_GEOM_TYPE[type];
    if (kind === undefined) {
      throw makeAdapterError('PARSE', `EFFIS/GWIS feature out of scope/missing geometry.type: '${type}'`);
    }
    const geometry = toDomainGeometry(type, raw.geometry?.coordinates);
    const base = {
      id: featureId(type, props),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind,
      geometry,
      observedAt: toIsoUtc(props.lastupdate ?? props.firedate, ctx.fetchedAt),
    };
    return makeHazardGeometry(
      typeof props.area_ha === 'number' && Number.isFinite(props.area_ha)
        ? { ...base, intensity: props.area_ha }
        : base,
    );
  },
};

/** Build the canonical GeoJSON geometry for a Point/Polygon/MultiPolygon feature. Throws PARSE if the
 * coordinates are missing/malformed (defensive — parseEffisFeatures already filters these out upstream). */
function toDomainGeometry(type: string, coordinates: unknown): HazardGeometry['geometry'] {
  if (type === 'Point') {
    if (!isPosition(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
      throw makeAdapterError('PARSE', `EFFIS/GWIS Point feature missing/invalid coordinates: ${JSON.stringify(coordinates)}`);
    }
    return { type: 'Point', coordinates };
  }
  if (type === 'Polygon') {
    if (!isPolygonCoords(coordinates)) {
      throw makeAdapterError('PARSE', `EFFIS/GWIS Polygon feature missing/invalid coordinates`);
    }
    return { type: 'Polygon', coordinates };
  }
  if (type === 'MultiPolygon') {
    if (!isMultiPolygonCoords(coordinates)) {
      throw makeAdapterError('PARSE', `EFFIS/GWIS MultiPolygon feature missing/invalid coordinates`);
    }
    return { type: 'MultiPolygon', coordinates };
  }
  throw makeAdapterError('PARSE', `EFFIS/GWIS feature unsupported geometry.type: '${type}'`);
}

/** Stable id from geometry kind + upstream feature id (deterministic, dedup-friendly). */
function featureId(type: string, props: EffisProps): HazardGeometryId {
  const short = type === 'Point' ? 'pt' : type === 'MultiPolygon' ? 'mpoly' : 'poly';
  return asId<HazardGeometryId>(`effis:${short}:${props.id ?? 'x'}`);
}

/** EFFIS/GWIS timestamps observed as either a bare date (YYYY-MM-DD), a zone-less datetime, or a
 * zoned ISO instant. Normalize all three to an explicit UTC instant (mirrors gdacs-acl.ts toIsoUtc). */
function toIsoUtc(t: string | undefined, fallback: string): string {
  if (t === undefined || t.trim() === '') return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T00:00:00Z`;
  return /(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : `${t}Z`;
}
