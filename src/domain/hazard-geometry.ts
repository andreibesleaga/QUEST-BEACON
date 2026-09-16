// BEACON — HAZARD_GEOMETRY entity (E1·T-051). Observed hazard footprint, provenance-anchored (Art. XI).
// Pure domain: no framework/HTTP/DB imports (F9).
import type { HazardGeometryId, IncidentId, SourceId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

// Enum mirrors schema.sql hazard_geometry.kind CHECK constraint.
// Storm family (ADR-032, FR-STORM-1/FU-9): TRACK (cyclone centre line), CONE (agency forecast cone) and
// STORM_SURGE (coastal inundation footprint). `CONE` is deliberately NOT `SPREAD_CONE`: that one is the
// BEACON-computed WILDFIRE spread projection (projectFireCone), a different provenance and a different
// uncertainty semantic — conflating them would blur "BEACON renders" with "BEACON models" (F-19).
export const HAZARD_KINDS = [
  'HOTSPOT',
  'PERIMETER',
  'FLOOD_REACH',
  'SPREAD_CONE',
  'TRACK',
  'CONE',
  'STORM_SURGE',
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/**
 * Which hazard kinds are IMPACT footprints — the only ones that may enter exposure/ranking (ADR-032 §3).
 *
 * `STORM_SURGE` is an impact polygon and participates exactly as `FLOOD_REACH` does (FEV-6). `TRACK` and
 * `CONE` are ADVISORY forecast geometry: an agency forecast cone is the uncertainty envelope of the storm
 * CENTRE's future position, not a footprint of expected conditions (hazardous wind/rain/surge extend well
 * beyond it, and it implies no uniform risk inside it — a misreading NHC/PAGASA both warn against). Feeding
 * it to `computeExposures` would classify infrastructure as "inside a hazard" from a positional-uncertainty
 * polygon — an engine number derived from the wrong semantic input is still an invented number (Art. XII).
 *
 * Exhaustive by construction: a new `HazardKind` fails `tsc` here until its exposure semantics are decided.
 */
export const EXPOSURE_BEARING_BY_KIND: Readonly<Record<HazardKind, boolean>> = {
  HOTSPOT: true,
  PERIMETER: true,
  FLOOD_REACH: true,
  SPREAD_CONE: true,
  TRACK: false, // advisory centre line — no areal footprint at all
  CONE: false, // track-centre uncertainty envelope, NOT an impact area
  STORM_SURGE: true, // impact footprint — treated exactly like FLOOD_REACH
};

/** True when a hazard of this kind may contribute to exposure/ranking (see EXPOSURE_BEARING_BY_KIND). */
export function isExposureBearingKind(kind: HazardKind): boolean {
  return EXPOSURE_BEARING_BY_KIND[kind];
}

export interface HazardGeometry {
  readonly id: HazardGeometryId;
  readonly incidentId: IncidentId;
  readonly sourceId: SourceId; // provenance is mandatory for an ingested footprint (Art. XI)
  readonly kind: HazardKind;
  readonly geometry: Geometry;
  readonly observedAt: string; // ISO-8601 — when the hazard was observed (freshness anchor)
  readonly intensity?: number;
}

export interface MakeHazardGeometryInput {
  readonly id: HazardGeometryId;
  readonly incidentId: IncidentId;
  readonly sourceId: SourceId;
  readonly kind: HazardKind;
  readonly geometry: Geometry;
  readonly observedAt: string;
  readonly intensity?: number;
}

const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPolygon'];

export function makeHazardGeometry(input: MakeHazardGeometryInput): HazardGeometry {
  if (!HAZARD_KINDS.includes(input.kind)) {
    throw new InvariantViolation(
      `HazardGeometry.kind must be one of ${HAZARD_KINDS.join('|')}, got ${String(input.kind)}`,
    );
  }
  if (input.sourceId === undefined || String(input.sourceId).length === 0) {
    throw new InvariantViolation('HazardGeometry.sourceId is required (provenance, Art. XI)');
  }
  if (input.geometry === undefined || !GEOMETRY_TYPES.includes(input.geometry.type)) {
    throw new InvariantViolation('HazardGeometry.geometry must be a valid GeoJSON geometry');
  }
  if (Number.isNaN(Date.parse(input.observedAt))) {
    throw new InvariantViolation(
      `HazardGeometry.observedAt must be a valid ISO-8601 instant, got ${input.observedAt}`,
    );
  }
  const base = {
    id: input.id,
    incidentId: input.incidentId,
    sourceId: input.sourceId,
    kind: input.kind,
    geometry: input.geometry,
    observedAt: input.observedAt,
  };
  return input.intensity === undefined ? base : { ...base, intensity: input.intensity };
}

/**
 * The exposure-eligible subset of an incident's hazards. Every exposure query builder filters through this
 * ONE predicate so advisory geometry (TRACK/CONE) can never leak into a deterministic exposure number,
 * while the MAP still renders the full, unfiltered hazard set (ADR-032 §3).
 */
export function exposureBearingHazards(
  hazards: readonly HazardGeometry[],
): readonly HazardGeometry[] {
  return hazards.filter((h) => isExposureBearingKind(h.kind));
}
