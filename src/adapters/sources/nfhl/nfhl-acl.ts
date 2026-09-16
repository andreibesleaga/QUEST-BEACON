// BEACON — NFHL anti-corruption layer (E4, NFHL exemplar; adapter-contract §4, F1/Art. XII). Maps a FEMA
// National Flood Hazard Layer (NFHL) MapServer GeoJSON flood-zone feature → a canonical FloodZone. This
// is the ONLY place the raw NFHL/Esri feature shape exists; no Esri field escapes above this module
// (AGENTS.md §3). Geometry is produced deterministically here — never the LLM.
//
// Honest limitation (see flood-zone.ts header): NFHL FLD_ZONE polygons are the REGULATORY effective
// floodplain (the FIRM) — a slow-changing legal/insurance boundary, NOT a live/observed flood extent.
//
// A MultiPolygon feature (one FLD_ZONE spanning several disjoint rings — common for NFHL, e.g. a coastal
// VE zone in several coves) is SPLIT into one row per polygon part at parse time, so every FloodZone.geom
// stays a single Polygon (the domain invariant) and each part gets a stable, distinct id. A feature with
// no usable geometry, an unsupported geometry type, invalid rings, or a blank FLD_ZONE is malformed and
// is SKIPPED — never silently vanished, the count is reported by parseNfhlZones (Art. XII).
import type { FloodZone } from '@/domain/index.js';
import { makeFloodZone } from '@/domain/index.js';
import type { PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { isPosition } from '@/domain/value-objects/geo.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';

interface NfhlRawGeometry {
  readonly type?: string;
  readonly coordinates?: unknown;
}

interface NfhlRawProperties {
  readonly FLD_ZONE?: string | null;
  readonly OBJECTID?: number | string | null;
}

/** One raw NFHL MapServer `f=geojson` feature, before geometry-part splitting. */
export interface NfhlRawFeature {
  readonly geometry?: NfhlRawGeometry | null;
  readonly properties?: NfhlRawProperties | null;
}

/** One row ready for the mapper: a single Polygon part + its zone + a stable per-part id suffix. */
export interface NfhlZoneRow {
  readonly zone: string;
  readonly polygon: PolygonGeometry;
  readonly objectId: string;
  readonly part: number; // 0 for a Polygon feature; the Nth ring-set of a split MultiPolygon otherwise
}

export interface ParsedNfhlZones {
  readonly rows: readonly NfhlZoneRow[];
  readonly skipped: number; // malformed features dropped at parse (counted, never silent — Art. XII)
}

/**
 * Parse an NFHL MapServer `f=geojson` FeatureCollection into mapper-ready rows. A MultiPolygon feature is
 * split into one row per polygon part; a feature with no usable geometry/zone is skipped and counted.
 */
export function parseNfhlZones(text: string): ParsedNfhlZones {
  const doc = JSON.parse(text) as { features?: NfhlRawFeature[] };
  const features = Array.isArray(doc.features) ? doc.features : [];
  const rows: NfhlZoneRow[] = [];
  let skipped = 0;
  features.forEach((feature, i) => {
    const zone = feature.properties?.FLD_ZONE?.trim();
    const objectId = String(feature.properties?.OBJECTID ?? `row${i}`);
    const parts = polygonPartsOf(feature.geometry);
    if (zone === undefined || zone === '' || parts.length === 0) {
      skipped += 1;
      return;
    }
    parts.forEach((polygon, part) => rows.push({ zone, polygon, objectId, part }));
  });
  return { rows, skipped };
}

/** Split a raw Esri Polygon/MultiPolygon geometry into individual single-Polygon parts. Anything else
 * (wrong type, missing/invalid rings) yields []. */
function polygonPartsOf(geom: NfhlRawGeometry | null | undefined): PolygonGeometry[] {
  if (geom === null || geom === undefined) return [];
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates;
    return isRingSet(rings) ? [{ type: 'Polygon', coordinates: rings }] : [];
  }
  if (geom.type === 'MultiPolygon') {
    const parts = geom.coordinates;
    if (!Array.isArray(parts)) return [];
    return parts
      .filter(isRingSet)
      .map((rings) => ({ type: 'Polygon' as const, coordinates: rings }));
  }
  return [];
}

function isRingSet(v: unknown): v is readonly (readonly Position[])[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition))
  );
}

// A row that fails makeFloodZone's invariants (should not happen — polygonPartsOf already validated the
// rings) throws InvariantViolation; mapRows (the anti-corruption runner) auto-wraps any non-AdapterError
// throw as a typed PARSE, so this mapper does not need its own try/catch (adapter-contract §4).
export const nfhlMapper: AntiCorruptionMapper<NfhlZoneRow, FloodZone> = {
  toCanonical(raw: NfhlZoneRow): FloodZone {
    return makeFloodZone({
      id: `nfhl:${raw.objectId}:${raw.part}`,
      zone: raw.zone,
      geom: raw.polygon,
    });
  },
};
